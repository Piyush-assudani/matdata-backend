const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cache = require('../lib/cache');
const { User, Organization, Voter } = require('../models/index');

exports.register = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ message: 'A valid email and a password of at least 8 characters are required.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = new User({
      _id: 'user_' + Date.now(),
      email: normalizedEmail,
      passwordHash: passwordHash,
      fullName: normalizedEmail.split('@')[0],
      phone: '0000000000',
      role: 'worker',
      organizationId: req.user.organizationId || 'org_default'
    });
    
    await user.save();
    res.status(201).json({ message: 'User registered successfully.' });
  } catch (err) {
    console.error('Account registration failed:', err.message);
    res.status(500).json({ message: 'Account could not be registered.' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password, username } = req.body;
    const loginIdentifier = (email || username || '').trim();
    if (!loginIdentifier || typeof password !== 'string') {
      return res.status(400).json({ message: 'Email/Username and password are required.' });
    }

    const safeRegex = loginIdentifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exactRegex = new RegExp(`^${safeRegex}$`, 'i');
    const prefixRegex = new RegExp(`^${safeRegex}@`, 'i');

    // Check user by email, username, prefix or fullName
    const user = await User.findOne({
      $or: [
        { email: exactRegex },
        { username: exactRegex },
        { email: prefixRegex },
        { fullName: exactRegex }
      ]
    });
    if (!user) return res.status(400).json({ message: 'गलत ईमेल/यूज़रनेम या पासवर्ड (Invalid Credentials)' });
    
    const org = await Organization.findById(user.organizationId);
    if (!org) return res.status(403).json({ message: 'Organization not found.' });
    
    if (user.isActive === false || org.isActive === false) {
      return res.status(403).json({
        code: 'ACCOUNT_SUSPENDED',
        error: 'Account Suspended',
        message: 'आपका खाता एडमिन द्वारा बंद (Suspend) किया गया है। कृपया आगे की सेवा के लिए एडमिन से संपर्क करें।',
        contact: {
          name: 'सिस्टम एडमिनिस्ट्रेशन (System Support)',
          phone: '',
          formattedPhone: 'पोर्टल एडमिन से संपर्क करें'
        }
      });
    }

    // Match password
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) return res.status(400).json({ message: 'Invalid Credentials' });

    // Generate token
    const enabledModules = user.role === 'admin'
      ? []
      : user.role === 'tenant_admin'
        ? (org.enabledModules || [])
        : (user.modules || []).filter((module) => (org.enabledModules || []).includes(module));
        
    const payload = {
      user: {
        id: user._id,
        email: user.email,
        name: user.fullName || user.email,
        role: user.role,
        organizationId: user.organizationId,
        organizationName: org.name || '',
        subRole: user.subRole || user.role,
        scopeType: user.scopeType || 'All',
        scopeValue: user.scopeValue || '',
        modules: enabledModules,
        allowedWards: org.allowedWards || [],
      }
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '365d' },
      (err, token) => {
        if (err) throw err;
        res.json({
          token,
          user: {
            id: user._id,
            email: user.email,
            name: user.fullName || user.email,
            role: user.role,
            subRole: user.subRole || user.role,
            organizationId: user.organizationId,
            organizationName: org.name || '',
            scope: user.scopeType || 'All',
            scopeValue: user.scopeValue || '',
            modules: enabledModules,
            allowedWards: org.allowedWards || [],
            settings: org.settings || { hidePartNo: true },
          },
        });
      }
    );
  } catch (err) {
    console.error('Login failed:', err.message);
    res.status(500).json({ message: 'Login could not be completed.' });
  }
};

exports.getClients = async (req, res) => {
  try {
    const isPlatformAdmin = req.user.role === 'admin';
    const cacheKey = `clients_list_${isPlatformAdmin ? 'admin' : (req.user.organizationId || 'org')}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    if (isPlatformAdmin) {
      const orgs = await Organization.find({ isActive: { $ne: false }, _id: { $ne: 'org_default' } }).sort({ name: 1 }).lean();
      const orgIds = orgs.map((o) => o._id);
      const voterCounts = await Voter.aggregate([
        { $match: { organizationId: { $in: orgIds } } },
        { $group: { _id: '$organizationId', count: { $sum: 1 } } },
      ]);
      const voterCountMap = {};
      voterCounts.forEach((vc) => {
        voterCountMap[vc._id] = vc.count;
      });
      const responseData = orgs.map((o) => ({
        id: o._id,
        name: o.name,
        code: o.code,
        candidateName: o.candidateName || '',
        candidateParty: o.candidateParty || '',
        voterCount: voterCountMap[o._id] || 0,
        settings: o.settings || { hidePartNo: true },
      }));
      cache.set(cacheKey, responseData, 120);
      return res.json(responseData);
    } else {
      const org = await Organization.findById(req.user.organizationId).lean();
      if (!org) return res.json([]);
      const voterCount = await Voter.countDocuments({ organizationId: org._id });
      const responseData = [
        {
          id: org._id,
          name: org.name,
          code: org.code,
          candidateName: org.candidateName || '',
          candidateParty: org.candidateParty || '',
          voterCount,
          settings: org.settings || { hidePartNo: true },
        },
      ];
      cache.set(cacheKey, responseData, 120);
      return res.json(responseData);
    }
  } catch (err) {
    console.error('Failed to get clients:', err);
    res.status(500).json({ message: 'Clients could not be loaded.' });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ message: 'A valid old password and a new password of at least 8 characters are required.' });
    }

    const userId = req.user.id;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.passwordHash);
    
    if (!isMatch) {
      return res.status(400).json({ message: 'Incorrect old password.' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('Change password failed:', err.message);
    res.status(500).json({ message: 'Could not change password.' });
  }
};

exports.getStatus = async (req, res) => {
  res.json({
    status: 'active',
    user: req.user
  });
};
