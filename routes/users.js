const express = require('express');
const bcrypt = require('bcryptjs');
const { User, Organization, Voter } = require('../models/index');
const { verifyToken, isOrganizationAdmin, requireModule } = require('../middleware/authMiddleware');
const { getEffectiveOrgId } = require('../lib/access');

const router = express.Router();
const roles = ['Operator', 'Booth Agent', 'Karyakarta', 'Viewer'];
const scopes = ['Booth', 'Ward', 'Village', 'All'];
const modules = ['voters', 'poll-desk', 'turnout', 'warroom', 'history', 'community', 'workers', 'migrants', 'accounts'];
const orgFor = (req) => req.user.organizationId || 'org_default';
const isPlatformAdmin = (req) => req.user.role === 'admin';

const selectAccounts = async (req, workersOnly) => {
  const query = {};
  
  const targetOrgId = getEffectiveOrgId(req);
  if (targetOrgId) {
    query.organizationId = targetOrgId;
  }
  
  if (workersOnly) {
    query.role = 'worker';
  } else {
    // Only fetch non-admin users for tenant viewing
    query.role = { $ne: 'admin' };
  }

  const users = await User.find(query).sort({ createdAt: -1 }).lean();
  
  const orgIds = [...new Set(users.map(u => u.organizationId))];
  const orgs = await Organization.find({ _id: { $in: orgIds } }).lean();
  const orgMap = orgs.reduce((acc, o) => ({ ...acc, [o._id]: o.name }), {});

  // Fetch assigned voters count
  const results = await Promise.all(users.map(async (u) => {
    const assignedVoters = await Voter.countDocuments({
      organizationId: u.organizationId,
      assignedWorker: { $in: [u.fullName, u.email] }
    });
    
    return {
      id: u._id,
      email: u.email,
      name: u.fullName || '',
      phone: u.phone || '',
      accountType: u.role,
      role: u.subRole || 'Operator',
      scope: u.scopeType || 'All',
      scopeValue: u.scopeValue || '',
      modules: u.modules || [],
      isActive: u.isActive,
      assignedVoters,
      organizationId: u.organizationId,
      organizationName: orgMap[u.organizationId] || u.organizationId,
      createdAt: u.createdAt,
    };
  }));
  
  return results;
};

const validateAccess = (body, enabledModules) => (
  roles.includes(body.subRole)
  && scopes.includes(body.scope)
  && Array.isArray(body.modules)
  && body.modules.every((module) => module !== 'accounts' && modules.includes(module) && enabledModules.includes(module))
  && (body.scope === 'All' || (typeof body.scopeValue === 'string' && body.scopeValue.trim()))
);

// Get User's Own Account Profile
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) return res.status(404).json({ message: 'User not found.' });

    res.json({
      id: user._id,
      email: user.email,
      name: user.fullName || '',
      phone: user.phone || '',
      role: user.role,
      subRole: user.subRole || user.role,
      scopeType: user.scopeType || 'All',
      scopeValue: user.scopeValue || '',
      modules: user.modules || [],
      isActive: user.isActive,
      organizationId: user.organizationId,
    });
  } catch (err) {
    console.error('Profile fetch failed:', err.message);
    res.status(500).json({ message: 'Profile could not be loaded.' });
  }
});

router.put('/profile', verifyToken, async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (typeof name !== 'string' || !name.trim() || typeof phone !== 'string' || !phone.trim()) {
      return res.status(400).json({ message: 'Valid name and phone are required.' });
    }
    const user = await User.findByIdAndUpdate(req.user.id, {
      fullName: name.trim(),
      phone: phone.trim()
    }, { returnDocument: 'after' }).lean();
    
    res.json({
      message: 'Profile updated successfully.',
      user: {
        name: user.fullName,
        phone: user.phone
      }
    });
  } catch (err) {
    console.error('Profile update failed:', err.message);
    res.status(500).json({ message: 'Profile could not be updated.' });
  }
});

router.get('/', verifyToken, isOrganizationAdmin, async (req, res) => {
  try {
    res.json(await selectAccounts(req, false));
  } catch (err) {
    console.error('Account list failed:', err.message);
    res.status(500).json({ message: 'Accounts could not be loaded.' });
  }
});

router.get('/workers', verifyToken, requireModule('workers'), async (req, res) => {
  try {
    res.json(await selectAccounts(req, true));
  } catch (err) {
    console.error('Worker list failed:', err.message);
    res.status(500).json({ message: 'Workers could not be loaded.' });
  }
});

router.post('/', verifyToken, isOrganizationAdmin, async (req, res) => {
  try {
    const { name, email, phone, password, role } = req.body;
    if (typeof name !== 'string' || !name.trim()
      || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ message: 'Valid name, email, and an 8-character password are required.' });
    }
    
    const targetOrgId = getEffectiveOrgId(req);
    const orgId = isPlatformAdmin(req) && targetOrgId
      ? targetOrgId
      : orgFor(req);
    const org = await Organization.findById(orgId).lean();

    if (!org) return res.status(404).json({ message: 'Organization not found.' });

    const accountRole = req.user.role === 'admin' ? (role === 'tenant_admin' ? 'tenant_admin' : 'worker') : 'worker';
    if (accountRole === 'worker') {
      const activeWorkers = await User.countDocuments({ organizationId: orgId, role: 'worker', isActive: true });
      if (activeWorkers >= 10) return res.status(409).json({ message: 'This organization has reached its limit of 10 active workers.' });
    }
    if (accountRole === 'worker' && !validateAccess(req.body, org.enabledModules || [])) {
      return res.status(400).json({ message: 'Invalid access parameters for worker.' });
    }
    
    const existing = await User.findOne({ email: email.trim().toLowerCase() });
    if (existing) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    
    await User.create({
      _id: `user_${Date.now()}_${Math.floor(Math.random()*1000)}`,
      email: email.trim().toLowerCase(),
      passwordHash: passwordHash,
      fullName: name.trim(),
      phone: typeof phone === 'string' ? phone.trim() : '0000000000',
      role: accountRole,
      organizationId: orgId,
      subRole: accountRole === 'worker' ? req.body.subRole : null,
      scopeType: accountRole === 'worker' ? req.body.scope : null,
      scopeValue: accountRole === 'worker' ? (req.body.scope === 'All' ? null : req.body.scopeValue.trim()) : null,
      modules: accountRole === 'worker' ? req.body.modules : [],
      isActive: true
    });
    
    res.status(201).json({ message: 'Account created successfully.' });
  } catch (err) {
    console.error('Account creation failed:', err.message);
    res.status(500).json({ message: 'Could not create account.' });
  }
});

router.put('/:id', verifyToken, isOrganizationAdmin, async (req, res) => {
  try {
    const orgId = orgFor(req);
    const query = { _id: req.params.id, role: 'worker' };
    if (!isPlatformAdmin(req)) query.organizationId = orgId;

    const hasPassword = Object.hasOwn(req.body, 'password');
    if (hasPassword && (typeof req.body.password !== 'string' || req.body.password.length < 8)) {
      return res.status(400).json({ message: 'A password of at least 8 characters is required.' });
    }

    const hasAccessChanges = ['subRole', 'scope', 'scopeValue', 'modules'].some((key) => Object.hasOwn(req.body, key));
    if (!hasAccessChanges && hasPassword) {
      const passwordHash = await bcrypt.hash(req.body.password, 10);
      const user = await User.findOneAndUpdate(query, { $set: { passwordHash } }, { returnDocument: 'after' });
      if (!user) return res.status(404).json({ message: 'Account not found or access denied.' });
      return res.json({ message: 'Account password updated successfully.' });
    }

    const existingAccount = await User.findOne(query).select('organizationId').lean();
    if (!existingAccount) return res.status(404).json({ message: 'Account not found or access denied.' });
    const org = await Organization.findById(existingAccount.organizationId).lean();
    if (!org) return res.status(404).json({ message: 'Organization not found.' });
    if (!validateAccess(req.body, org.enabledModules || [])) {
      return res.status(400).json({ message: 'Invalid access parameters.' });
    }

    const { name, phone } = req.body;
    const update = {
      subRole: req.body.subRole,
      scopeType: req.body.scope,
      scopeValue: req.body.scope === 'All' ? null : req.body.scopeValue.trim(),
      modules: req.body.modules,
    };
    if (typeof name === 'string' && name.trim()) update.fullName = name.trim();
    if (typeof phone === 'string' && phone.trim()) update.phone = phone.trim();
    if (hasPassword) update.passwordHash = await bcrypt.hash(req.body.password, 10);

    const user = await User.findOneAndUpdate(query, { $set: update }, { returnDocument: 'after' });
    if (!user) return res.status(404).json({ message: 'Account not found or access denied.' });
    res.json({ message: 'Account updated successfully.' });
  } catch (err) {
    console.error('Account update failed:', err.message);
    res.status(500).json({ message: 'Could not update account.' });
  }
});

router.put('/:id/active', verifyToken, isOrganizationAdmin, async (req, res) => {
  try {
    if (req.body.isActive !== false) {
      return res.status(400).json({ message: 'Only account deactivation is supported by this action.' });
    }
    const query = { _id: req.params.id, role: 'worker' };
    if (!isPlatformAdmin(req)) query.organizationId = orgFor(req);
    const user = await User.findOneAndUpdate(query, { $set: { isActive: false } }, { returnDocument: 'after' });
    if (!user) return res.status(404).json({ message: 'Account not found or access denied.' });
    res.json({ message: 'Account disabled successfully.' });
  } catch (err) {
    console.error('Account deactivation failed:', err.message);
    res.status(500).json({ message: 'Could not disable account.' });
  }
});

router.delete('/:id', verifyToken, isOrganizationAdmin, async (req, res) => {
  try {
    const query = { _id: req.params.id, role: 'worker' };
    if (!isPlatformAdmin(req)) query.organizationId = orgFor(req);

    const result = await User.deleteOne(query);
    if (result.deletedCount === 0) return res.status(404).json({ message: 'Account not found or access denied.' });
    res.json({ message: 'Account deleted successfully.' });
  } catch (err) {
    console.error('Account deletion failed:', err.message);
    res.status(500).json({ message: 'Could not delete account.' });
  }
});

module.exports = router;
