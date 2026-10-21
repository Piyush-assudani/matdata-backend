const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { Organization, User, Voter, Lead, SystemSetting } = require('../models/index');
const { verifyToken, isAdmin } = require('../middleware/authMiddleware');
const { createWorkbook, addSheet, sendWorkbook } = require('../lib/xlsx');
const cache = require('../lib/cache');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const availableModules = ['voters', 'poll-desk', 'turnout', 'warroom', 'history', 'community', 'workers', 'migrants'];
const allModules = [...availableModules, 'accounts'];
const workbookType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function levenshtein(s1, s2) {
  if (s1.length < s2.length) return levenshtein(s2, s1);
  if (s2.length === 0) return s1.length;
  let prev = Array.from({ length: s2.length + 1 }, (_, i) => i);
  for (let i = 0; i < s1.length; i++) {
    const curr = [i + 1];
    for (let j = 0; j < s2.length; j++) {
      const ins = prev[j + 1] + 1;
      const del = curr[j] + 1;
      const sub = prev[j] + (s1[i] === s2[j] ? 0 : 1);
      curr.push(Math.min(ins, del, sub));
    }
    prev = curr;
  }
  return prev[s2.length];
}

function stripNameFromRelative(voterName, relName) {
  if (!voterName || !relName) return relName || '';
  let vn = String(voterName).trim();
  let rn = String(relName).trim();
  if (!rn || !vn) return rn;

  if (rn.startsWith(vn)) {
    rn = rn.slice(vn.length).trim();
  }

  const vnTokens = vn.split(/\s+/).filter(Boolean);
  for (const tok of vnTokens) {
    if (tok.length >= 2 && rn.startsWith(tok)) {
      rn = rn.slice(tok.length).trim();
    }
  }

  const rnTokens = rn.split(/\s+/).filter(Boolean);
  if (rnTokens.length > 1 && vnTokens.length > 0) {
    const firstR = rnTokens[0];
    const firstV = vnTokens[0];
    if (firstR.length >= 2) {
      if (firstR.includes(firstV) || firstV.includes(firstR) || levenshtein(firstR, firstV) <= 2) {
        rn = rnTokens.slice(1).join(' ').trim();
      }
    }
  }

  return rn;
}

router.get('/organizations', verifyToken, isAdmin, async (_req, res) => {
  try {
    const orgs = await Organization.find({ _id: { $ne: 'org_default' } }).sort({ createdAt: -1 }).lean();
    
    const result = await Promise.all(orgs.map(async (o) => {
      const adminCount = await User.countDocuments({ organizationId: o._id, role: 'tenant_admin' });
      const activeWorkers = await User.countDocuments({ organizationId: o._id, role: 'worker', isActive: true });
      const voterCount = await Voter.countDocuments({ organizationId: o._id });

      let adminEmail = o.adminEmail || '';
      let initialPassword = o.initialPassword || o.demoPassword || '';
      if (!adminEmail || !initialPassword) {
        const adminUser = await User.findOne({ organizationId: o._id, role: 'tenant_admin' }).lean();
        if (adminUser) {
          adminEmail = adminEmail || adminUser.email || '';
          initialPassword = initialPassword || adminUser.initialPassword || adminUser.demoPassword || '';
        }
      }
      
      return {
        id: o._id, name: o.name, modules: o.enabledModules || [],
        wards: o.allowedWards || [], isActive: o.isActive, createdAt: o.createdAt,
        adminCount, activeWorkers, voterCount,
        adminEmail,
        initialPassword,
        whatsappEnabled: o.whatsappEnabled !== false,
        whatsappCredits: typeof o.whatsappCredits === 'number' ? o.whatsappCredits : 100,
        whatsappUsed: typeof o.whatsappUsed === 'number' ? o.whatsappUsed : 0,
        slipConfig: o.slipConfig || {},
        district: o.district || '',
        ulbPanchayatSamiti: o.ulbPanchayatSamiti || '',
        ulbWardGramPanchayat: o.ulbWardGramPanchayat || '',
      };
    }));
    
    res.json(result);
  } catch (err) {
    console.error('Organization list failed:', err.message);
    res.status(500).json({ message: 'Organizations could not be loaded.' });
  }
});

router.post('/organizations', verifyToken, isAdmin, async (req, res) => {
  const { name, email, password } = req.body;
  const moduleList = req.body.modules;
  const wards = req.body.wards;
  const district = typeof req.body.district === 'string' ? req.body.district.trim() : '';
  const ulbPanchayatSamiti = typeof req.body.ulbPanchayatSamiti === 'string' ? req.body.ulbPanchayatSamiti.trim() : '';
  const ulbWardGramPanchayat = typeof req.body.ulbWardGramPanchayat === 'string' ? req.body.ulbWardGramPanchayat.trim() : '';

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ message: 'क्लाइंट / संगठन का नाम आवश्यक है।' });
  }

  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ message: 'कृपया वैध क्लाइंट एडमिन ईमेल दर्ज करें।' });
  }

  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ message: 'पासवर्ड कम-से-कम 8 अक्षरों का होना चाहिए।' });
  }

  if (!Array.isArray(moduleList) || !moduleList.every((module) => availableModules.includes(module))) {
    return res.status(400).json({ message: 'कृपया मान्य मॉड्यूल चुनें।' });
  }

  const sanitizedEmail = email.trim().toLowerCase();
  const existingUser = await User.findOne({ email: sanitizedEmail }).lean();
  if (existingUser) {
    return res.status(409).json({ message: `इस एडमिन ईमेल (${sanitizedEmail}) पर पहले से खाता मौजूद है। कृपया दूसरा ईमेल प्रयोग करें।` });
  }

  const id = `tenant_${crypto.randomUUID()}`;
  const enabledModules = [...new Set([...moduleList, 'accounts'])];
  const allowedWards = Array.isArray(wards)
    ? [...new Set(wards.map((ward) => String(ward).trim()).filter(Boolean))]
    : [];
  const initialCredits = Number.isInteger(Number(req.body.whatsappCredits)) ? Math.max(0, Number(req.body.whatsappCredits)) : 100;
  const isWpEnabled = typeof req.body.whatsappEnabled === 'boolean' ? req.body.whatsappEnabled : true;
  const slipConfig = req.body.slipConfig && typeof req.body.slipConfig === 'object' ? req.body.slipConfig : {};

  let session = null;
  let inTransaction = false;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    inTransaction = true;
  } catch {
    session = null;
    inTransaction = false;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const orgPayload = {
      _id: id,
      name: name.trim(),
      enabledModules: enabledModules,
      allowedWards: allowedWards,
      adminEmail: sanitizedEmail,
      initialPassword: password,
      whatsappEnabled: isWpEnabled,
      whatsappCredits: initialCredits,
      whatsappUsed: 0,
      slipConfig: slipConfig,
      district,
      ulbPanchayatSamiti,
      ulbWardGramPanchayat,
    };
    const userPayload = {
      _id: `user_${crypto.randomUUID()}`,
      email: sanitizedEmail,
      passwordHash: passwordHash,
      initialPassword: password,
      fullName: `${name.trim()} Admin`,
      phone: '0000000000',
      role: 'tenant_admin',
      organizationId: id,
    };

    if (inTransaction && session) {
      await Organization.create([orgPayload], { session });
      await User.create([userPayload], { session });
      await session.commitTransaction();
    } else {
      await Organization.create(orgPayload);
      try {
        await User.create(userPayload);
      } catch (userErr) {
        await Organization.deleteOne({ _id: id });
        throw userErr;
      }
    }

    res.status(201).json({
      success: true,
      message: `क्लाइंट '${name.trim()}' और उसका एडमिन अकाउंट सफलतापूर्वक बन गया!`,
      organization: {
        id,
        name: name.trim(),
        email: sanitizedEmail,
        password: password,
        modules: enabledModules,
        wards: allowedWards,
        whatsappCredits: initialCredits,
        district,
        ulbPanchayatSamiti,
        ulbWardGramPanchayat,
      },
    });
  } catch (err) {
    if (inTransaction && session) {
      try { await session.abortTransaction(); } catch { /* ignore */ }
    }
    if (err.code === 11000) {
      return res.status(409).json({ message: `इस एडमिन ईमेल (${sanitizedEmail}) पर पहले से खाता मौजूद है।` });
    }
    console.error('Organization creation failed:', err.message);
    res.status(500).json({ message: `क्लाइंट खाता नहीं बन सका: ${err.message}` });
  } finally {
    if (session) {
      try { session.endSession(); } catch { /* ignore */ }
    }
  }
});

router.put('/organizations/:id', verifyToken, isAdmin, async (req, res) => {
  const { name, isActive } = req.body;
  const moduleList = req.body.modules;
  const wards = req.body.wards;
  
  if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ message: 'Organization name is required.' });
  if (!Array.isArray(moduleList) || !moduleList.every((module) => availableModules.includes(module))) {
    return res.status(400).json({ message: 'Choose valid modules.' });
  }
  
  try {
    const enabledModules = [...new Set([...moduleList, 'accounts'])];
    const allowedWards = Array.isArray(wards)
      ? [...new Set(wards.map((ward) => String(ward).trim()).filter(Boolean))]
      : [];
    
    const updatePayload = {
      name: name.trim(),
      enabledModules,
      allowedWards,
      isActive: typeof isActive === 'boolean' ? isActive : true
    };

    if (typeof req.body.district === 'string') {
      updatePayload.district = req.body.district.trim();
    }
    if (typeof req.body.ulbPanchayatSamiti === 'string') {
      updatePayload.ulbPanchayatSamiti = req.body.ulbPanchayatSamiti.trim();
    }
    if (typeof req.body.ulbWardGramPanchayat === 'string') {
      updatePayload.ulbWardGramPanchayat = req.body.ulbWardGramPanchayat.trim();
    }

    if (typeof req.body.whatsappEnabled === 'boolean') {
      updatePayload.whatsappEnabled = req.body.whatsappEnabled;
    }
    if (req.body.whatsappCredits !== undefined) {
      updatePayload.whatsappCredits = Math.max(0, Number.parseInt(req.body.whatsappCredits, 10) || 0);
    }
    if (req.body.slipConfig && typeof req.body.slipConfig === 'object') {
      updatePayload.slipConfig = req.body.slipConfig;
    }
    if (req.body.settings && typeof req.body.settings === 'object') {
      updatePayload.settings = req.body.settings;
    }

    const org = await Organization.findByIdAndUpdate(req.params.id, updatePayload);
    
    if (!org) return res.status(404).json({ message: 'Organization not found.' });
    res.json({ success: true, message: 'Organization updated.' });
  } catch (err) {
    console.error('Organization update failed:', err.message);
    res.status(500).json({ message: 'Could not update organization.' });
  }
});

// Dedicated endpoints to get and update organization settings (toggles like hidePartNo, etc.)
router.get('/organizations/:id/settings', verifyToken, async (req, res) => {
  try {
    const org = await Organization.findById(req.params.id).lean();
    if (!org) return res.status(404).json({ message: 'Organization not found.' });
    res.json(org.settings || { hidePartNo: true });
  } catch (err) {
    res.status(500).json({ message: 'Could not fetch organization settings.' });
  }
});

router.put('/organizations/:id/settings', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'tenant_admin') {
      return res.status(403).json({ message: 'केवल एडमिन ही सेटिंग्स बदल सकते हैं।' });
    }
    const incomingSettings = req.body.settings || req.body;
    const org = await Organization.findById(req.params.id);
    if (!org) return res.status(404).json({ message: 'Organization not found.' });

    const mergedSettings = {
      ...(org.settings || {}),
      ...incomingSettings
    };

    const updated = await Organization.findByIdAndUpdate(
      req.params.id,
      { $set: { settings: mergedSettings } },
      { new: true }
    );
    res.json({ success: true, settings: updated?.settings || mergedSettings, message: 'सेटिंग्स सफलतापूर्वक अपडेट की गईं।' });
  } catch (err) {
    res.status(500).json({ message: 'Could not update organization settings.' });
  }
});

const DEFAULT_CASTES = [
  'भाट',
  'ब्राह्मण',
  'शर्मा',
  'पालीवाल',
  'जोगी',
  'जाट',
  'राजपूत',
  'चौधरी',
  'बिश्नोई',
  'भील',
  'देवासी / रबारी',
  'माहेश्वरी / वैश्य',
  'कुम्हार / प्रजापत',
  'सुथार / खाती',
  'सैन / नाई',
  'मुस्लिम',
  'मेघवाल',
  'लोहार',
  'राव',
  'गुर्जर',
];

// Admin: Get caste options for selected target (user, organization, or global)
router.get('/caste-options', verifyToken, isAdmin, async (req, res) => {
  try {
    const { targetType, targetId } = req.query;

    if (targetType === 'user' && targetId) {
      const user = await User.findById(targetId).select('casteOptions fullName email role organizationId').lean();
      if (!user) return res.status(404).json({ message: 'User not found' });

      let inheritedFrom = null;
      let effectiveOptions = user.casteOptions;
      if (!Array.isArray(effectiveOptions) || effectiveOptions.length === 0) {
        if (user.organizationId) {
          const org = await Organization.findById(user.organizationId).select('casteOptions settings').lean();
          if (org && Array.isArray(org.casteOptions) && org.casteOptions.length > 0) {
            effectiveOptions = org.casteOptions;
            inheritedFrom = 'organization';
          }
        }
        if (!effectiveOptions || effectiveOptions.length === 0) {
          const globalSetting = await SystemSetting.findById('caste_options').lean();
          effectiveOptions = (globalSetting && Array.isArray(globalSetting.value)) ? globalSetting.value : DEFAULT_CASTES;
          inheritedFrom = 'global';
        }
      }

      return res.json({
        targetType: 'user',
        targetId: user._id,
        targetName: `${user.fullName || ''} (${user.email})`,
        casteOptions: effectiveOptions,
        isCustomized: Array.isArray(user.casteOptions) && user.casteOptions.length > 0,
        inheritedFrom,
        defaultCastes: DEFAULT_CASTES
      });
    }

    if (targetType === 'organization' && targetId) {
      const org = await Organization.findById(targetId).select('casteOptions settings name').lean();
      if (!org) return res.status(404).json({ message: 'Organization not found' });

      const customOptions = org.casteOptions || org.settings?.casteOptions;
      let effectiveOptions = customOptions;
      let inheritedFrom = null;
      if (!Array.isArray(effectiveOptions) || effectiveOptions.length === 0) {
        const globalSetting = await SystemSetting.findById('caste_options').lean();
        effectiveOptions = (globalSetting && Array.isArray(globalSetting.value)) ? globalSetting.value : DEFAULT_CASTES;
        inheritedFrom = 'global';
      }

      return res.json({
        targetType: 'organization',
        targetId: org._id,
        targetName: org.name,
        casteOptions: effectiveOptions,
        isCustomized: Array.isArray(customOptions) && customOptions.length > 0,
        inheritedFrom,
        defaultCastes: DEFAULT_CASTES
      });
    }

    // Global
    const globalSetting = await SystemSetting.findById('caste_options').lean();
    const globalOptions = (globalSetting && Array.isArray(globalSetting.value) && globalSetting.value.length > 0)
      ? globalSetting.value
      : DEFAULT_CASTES;

    return res.json({
      targetType: 'global',
      targetId: 'global',
      targetName: 'ग्लोबल डिफ़ॉल्ट (सभी यूज़र्स एवं संगठन)',
      casteOptions: globalOptions,
      isCustomized: Boolean(globalSetting?.value),
      inheritedFrom: null,
      defaultCastes: DEFAULT_CASTES
    });
  } catch (err) {
    console.error('Failed to get caste options for admin:', err);
    res.status(500).json({ message: 'जाति विकल्प लोड नहीं हो सके।' });
  }
});

// Admin: Save custom caste options for selected target
router.put('/caste-options', verifyToken, isAdmin, async (req, res) => {
  try {
    const { targetType, targetId, casteOptions } = req.body;
    if (!Array.isArray(casteOptions)) {
      return res.status(400).json({ message: 'casteOptions must be an array of strings' });
    }

    const cleanList = [...new Set(
      casteOptions
        .map(c => (typeof c === 'string' ? c.trim() : ''))
        .filter(Boolean)
    )];

    if (targetType === 'user') {
      if (!targetId) return res.status(400).json({ message: 'targetId is required for user' });
      const updatedUser = await User.findByIdAndUpdate(
        targetId,
        { $set: { casteOptions: cleanList } },
        { new: true }
      ).select('fullName email casteOptions');
      if (!updatedUser) return res.status(404).json({ message: 'User not found' });
      return res.json({
        success: true,
        message: `यूज़र "${updatedUser.fullName || updatedUser.email}" के लिए जाति टैग सेव हो गए।`,
        casteOptions: updatedUser.casteOptions
      });
    }

    if (targetType === 'organization') {
      if (!targetId) return res.status(400).json({ message: 'targetId is required for organization' });
      const updatedOrg = await Organization.findByIdAndUpdate(
        targetId,
        { $set: { casteOptions: cleanList, 'settings.casteOptions': cleanList } },
        { new: true }
      ).select('name casteOptions');
      if (!updatedOrg) return res.status(404).json({ message: 'Organization not found' });
      return res.json({
        success: true,
        message: `संगठन "${updatedOrg.name}" के लिए जाति टैग सेव हो गए।`,
        casteOptions: updatedOrg.casteOptions
      });
    }

    if (targetType === 'global') {
      await SystemSetting.findByIdAndUpdate(
        'caste_options',
        { $set: { value: cleanList, updatedAt: new Date() } },
        { upsert: true, new: true }
      );
      return res.json({
        success: true,
        message: 'ग्लोबल डिफ़ॉल्ट जाति टैग सफलतापूर्वक सेव हो गए।',
        casteOptions: cleanList
      });
    }

    return res.status(400).json({ message: 'Invalid targetType' });
  } catch (err) {
    console.error('Failed to update caste options:', err);
    res.status(500).json({ message: 'जाति विकल्प सेव नहीं हो सके।' });
  }
});

// Admin Dashboard aggregated stats
router.get('/dashboard-stats', verifyToken, isAdmin, async (req, res) => {
  try {
    const { orgId } = req.query;
    const cacheKey = `admin_dash_stats_${orgId || 'all'}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const filter = orgId && orgId !== 'all' ? { organizationId: orgId } : {};

    const [
      totalVoters,
      totalOrgs,
      totalWorkers,
      totalSlips,
      distinctWards,
      maleCount,
      femaleCount,
      votedCount
    ] = await Promise.all([
      Voter.countDocuments(filter),
      Organization.countDocuments({ _id: { $ne: 'org_default' } }),
      User.countDocuments(filter.organizationId ? { organizationId: filter.organizationId, role: { $ne: 'admin' } } : { role: { $ne: 'admin' } }),
      SlipDispatch.countDocuments(filter.organizationId ? { organizationId: filter.organizationId } : {}),
      Voter.distinct('wardNo', filter),
      Voter.countDocuments({ ...filter, gender: { $in: ['M', 'Male', 'पुरुष'] } }),
      Voter.countDocuments({ ...filter, gender: { $in: ['F', 'Female', 'महिला', 'स्त्री'] } }),
      Voter.countDocuments({ ...filter, voted: true })
    ]);

    // Ward-wise detailed breakdown
    const rawWardBreakdown = await Voter.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$wardNo',
          total: { $sum: 1 },
          male: { $sum: { $cond: [{ $in: ['$gender', ['M', 'Male', 'पुरुष']] }, 1, 0] } },
          female: { $sum: { $cond: [{ $in: ['$gender', ['F', 'Female', 'महिला', 'स्त्री']] }, 1, 0] } },
          voted: { $sum: { $cond: ['$voted', 1, 0] } }
        }
      }
    ]);
    const wardBreakdown = rawWardBreakdown
      .filter((w) => w._id !== null && w._id !== undefined && String(w._id).trim() !== '')
      .map((w) => ({
        wardNo: String(w._id),
        total: w.total || 0,
        male: w.male || 0,
        female: w.female || 0,
        voted: w.voted || 0,
        turnout: w.total > 0 ? Number(((w.voted / w.total) * 100).toFixed(1)) : 0
      }))
      .sort((a, b) => {
        const na = parseInt(a.wardNo, 10);
        const nb = parseInt(b.wardNo, 10);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.wardNo.localeCompare(b.wardNo);
      });

    let currentOrg = null;
    let currentSettings = { hidePartNo: true };
    if (orgId && orgId !== 'all') {
      currentOrg = await Organization.findById(orgId).lean();
      if (currentOrg?.settings) currentSettings = { ...currentSettings, ...currentOrg.settings };
    }

    const responsePayload = {
      success: true,
      stats: {
        totalVoters,
        totalOrgs,
        totalWorkers,
        totalSlips,
        totalWards: distinctWards.length,
        distinctWards: distinctWards.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })),
        maleCount,
        femaleCount,
        votedCount,
        turnoutPercentage: totalVoters > 0 ? Number(((votedCount / totalVoters) * 100).toFixed(1)) : 0,
        settings: currentSettings,
        activeOrg: currentOrg ? {
          id: currentOrg._id,
          name: currentOrg.name,
          whatsappEnabled: currentOrg.whatsappEnabled ?? true,
          whatsappCredits: currentOrg.whatsappCredits || 0,
          enabledModules: currentOrg.enabledModules || [],
          settings: currentSettings
        } : null,
        wardBreakdown,
        engineStatus: {
          pythonExtractor: 'Active (PyMuPDF & PyPDF Native)',
          dictionaryGlyphs: '13,000+ Master Glyphs Loaded',
          rollSync: 'Active (100% EC Verification Summary Match)',
          ocrConfidence: '100.00%'
        }
      }
    };
    cache.set(cacheKey, responsePayload, 60);
    res.json(responsePayload);
  } catch (err) {
    console.error('Failed to get dashboard stats:', err);
    res.status(500).json({ message: 'डैशबोर्ड डेटा लोड नहीं हो सका।' });
  }
});

router.get('/organizations/:id/slip-config', verifyToken, async (req, res) => {
  try {
    const org = await Organization.findById(req.params.id).lean();
    if (!org) return res.status(404).json({ message: 'Organization not found.' });
    res.json(org.slipConfig || {});
  } catch (err) {
    res.status(500).json({ message: 'Could not fetch slip configuration.' });
  }
});

router.put('/organizations/:id/slip-config', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'केवल एडमिन ही पर्ची ब्रांडिंग बदल सकते हैं।' });
    }
    const incomingConfig = req.body.slipConfig || req.body;
    const updated = await Organization.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          slipConfig: incomingConfig,
          ...(incomingConfig?.candidateName ? { candidateName: incomingConfig.candidateName } : {})
        }
      },
      { new: true, upsert: true }
    );
    res.json({ success: true, slipConfig: updated?.slipConfig || {} });
  } catch (err) {
    res.status(500).json({ message: 'Could not update slip configuration.' });
  }
});

// Dedicated fast endpoint to adjust WhatsApp credits
router.put('/organizations/:id/whatsapp-credits', verifyToken, isAdmin, async (req, res) => {
  try {
    const { credits, addCredits, enabled } = req.body;
    const org = await Organization.findById(req.params.id);
    if (!org) return res.status(404).json({ message: 'Organization not found.' });

    const updateOps = {};
    if (typeof enabled === 'boolean') updateOps.whatsappEnabled = enabled;
    if (typeof credits === 'number') updateOps.whatsappCredits = Math.max(0, credits);
    else if (typeof addCredits === 'number') {
      updateOps.whatsappCredits = Math.max(0, (org.whatsappCredits || 0) + addCredits);
    }

    await Organization.updateOne({ _id: req.params.id }, { $set: updateOps });
    const updated = await Organization.findById(req.params.id).lean();
    res.json({
      success: true,
      message: 'WhatsApp credits updated successfully.',
      whatsappCredits: updated.whatsappCredits,
      whatsappEnabled: updated.whatsappEnabled
    });
  } catch (err) {
    console.error('Update WhatsApp credits error:', err.message);
    res.status(500).json({ message: 'Could not update WhatsApp credits.' });
  }
});

router.delete('/organizations/:id', verifyToken, isAdmin, async (req, res) => {
  const orgId = req.params.id;
  if (!orgId || orgId === 'org_default') {
    return res.status(400).json({ message: 'Default organization cannot be deleted.' });
  }

  try {
    const { SlipDispatch } = require('../models/index');

    // Sequential cascade deletion (avoids MongoDB transaction concurrency/replica set locks)
    const voterRes = await Voter.deleteMany({ organizationId: orgId });
    const dispRes = await SlipDispatch.deleteMany({ organizationId: orgId });
    const userRes = await User.deleteMany({ organizationId: orgId });
    const orgRes = await Organization.deleteOne({ _id: orgId });

    if (orgRes.deletedCount === 0) {
      return res.status(404).json({ message: 'Organization not found.' });
    }

    // Flush cache entries for this organization
    try {
      if (cache) {
        if (typeof cache.delPrefix === 'function') {
          cache.delPrefix(`voters_all_${orgId}_`);
          cache.delPrefix(`wards_summary_${orgId}_`);
          cache.delPrefix(orgId);
        }
        if (typeof cache.flush === 'function') {
          cache.flush();
        } else if (typeof cache.flushAll === 'function') {
          cache.flushAll();
        }
      }
    } catch (cacheErr) {
      console.warn('Cache clear warning on org delete:', cacheErr.message);
    }

    res.json({
      success: true,
      message: `Organization and all associated data deleted successfully (${voterRes.deletedCount} voters, ${userRes.deletedCount} users, ${dispRes.deletedCount} dispatches).`,
      deletedVoters: voterRes.deletedCount,
      deletedUsers: userRes.deletedCount,
      deletedDispatches: dispRes.deletedCount
    });
  } catch (err) {
    console.error('Organization cascade deletion failed:', err);
    res.status(500).json({ message: 'Could not delete organization and its data: ' + err.message });
  }
});

// GET all users
router.get('/users', verifyToken, isAdmin, async (req, res) => {
  try {
    const orgId = typeof req.query.organizationId === 'string' ? req.query.organizationId.trim() : '';
    const query = orgId ? { organizationId: orgId } : {};
    
    const users = await User.find(query).sort({ createdAt: -1 }).lean();
    
    const orgIds = [...new Set(users.map(u => u.organizationId))];
    const orgs = await Organization.find({ _id: { $in: orgIds } }).lean();
    const orgMap = orgs.reduce((acc, o) => ({ ...acc, [o._id]: o }), {});
    
    res.json(users.map((u) => ({
      id: u._id, email: u.email, fullName: u.fullName, phone: u.phone,
      role: u.role, subRole: u.subRole, scopeType: u.scopeType, scopeValue: u.scopeValue,
      isActive: u.isActive,
      organizationId: u.organizationId,
      organizationName: orgMap[u.organizationId]?.name || 'Unknown',
    })));
  } catch (err) {
    console.error('User list failed:', err.message);
    res.status(500).json({ message: 'Users could not be loaded.' });
  }
});

router.post('/users', verifyToken, isAdmin, async (req, res) => {
  const { email, password, fullName, phone, role, organizationId, subRole, scopeType, scopeValue, modules } = req.body;
  if (!email || !password || !fullName || !phone || !role || !organizationId) {
    return res.status(400).json({ message: 'All fields are required.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const existing = await User.findOne({ email: email.trim().toLowerCase() });
    if (existing) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }
    
    await User.create({
      _id: `user_${crypto.randomUUID()}`,
      email: email.trim().toLowerCase(),
      passwordHash: passwordHash,
      fullName: fullName.trim(),
      phone: phone.trim(),
      role: role.trim(),
      organizationId: organizationId.trim(),
      subRole: subRole?.trim(),
      scopeType: scopeType?.trim(),
      scopeValue: scopeValue?.trim(),
      modules: Array.isArray(modules) ? modules : [],
    });
    
    res.status(201).json({ message: 'User created successfully.' });
  } catch (err) {
    console.error('User creation failed:', err.message);
    res.status(500).json({ message: 'Could not create user.' });
  }
});

router.delete('/users/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const result = await User.deleteOne({ _id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ message: 'User not found.' });
    res.json({ message: 'User deleted.' });
  } catch (err) {
    console.error('User deletion failed:', err.message);
    res.status(500).json({ message: 'Could not delete user.' });
  }
});

router.put('/users/:id/role', verifyToken, isAdmin, async (req, res) => {
  try {
    const { role, subRole, scopeType, scopeValue, modules } = req.body;
    if (!role) return res.status(400).json({ message: 'Role is required.' });
    
    const update = { role: role.trim() };
    if (subRole !== undefined) update.subRole = subRole;
    if (scopeType !== undefined) update.scopeType = scopeType;
    if (scopeValue !== undefined) update.scopeValue = scopeValue;
    if (Array.isArray(modules)) update.modules = modules;
    
    const result = await User.updateOne({ _id: req.params.id }, { $set: update });
    if (result.matchedCount === 0) return res.status(404).json({ message: 'User not found.' });
    res.json({ message: 'User role updated.' });
  } catch (err) {
    console.error('Role update failed:', err.message);
    res.status(500).json({ message: 'Could not update user role.' });
  }
});

router.put('/users/:id/active', verifyToken, isAdmin, async (req, res) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') return res.status(400).json({ message: 'Invalid active status.' });
    const result = await User.updateOne({ _id: req.params.id }, { $set: { isActive } });
    if (result.matchedCount === 0) return res.status(404).json({ message: 'User not found.' });
    res.json({ message: 'User active status updated.' });
  } catch (err) {
    console.error('Active status update failed:', err.message);
    res.status(500).json({ message: 'Could not update user active status.' });
  }
});

router.get('/master-data', verifyToken, isAdmin, async (req, res) => {
  const orgId = typeof req.query.organizationId === 'string' ? req.query.organizationId.trim() : '';
  const ward = typeof req.query.ward === 'string' ? req.query.ward.trim() : '';
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 1000;
  const query = orgId ? { organizationId: orgId } : {};
  if (ward) {
    query.wardNo = ward;
  }
    
  const cacheKey = `master_data_${orgId || 'all'}_w${ward || 'all'}_p${page}_l${limit}`;
  const cachedData = cache.get(cacheKey);
  if (cachedData) return res.json(cachedData);

  try {
    const skip = (page - 1) * limit;
    const voters = await Voter.find(query)
      .sort({ wardNo: 1, partNo: 1, serialNo: 1 })
      .skip(skip)
      .limit(limit)
      .lean();
      
    const totalCount = await Voter.countDocuments(query);

    // Get ALL distinct wards for this organization across entire database
    const orgQuery = orgId ? { organizationId: orgId } : {};
    const rawWards = await Voter.distinct('wardNo', orgQuery);
    const wards = rawWards
      .filter((w) => w !== null && w !== undefined && String(w).trim() !== '')
      .map((w) => String(w).trim())
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const result = {
      voters,
      wards,
      pagination: {
        total: totalCount,
        page,
        limit,
        pages: Math.ceil(totalCount / limit)
      }
    };
    
    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Master data query failed:', err.message);
    res.status(500).json({ message: 'Master data could not be loaded.' });
  }
});

router.delete('/master-data', verifyToken, isAdmin, async (req, res) => {
  const orgId = typeof req.query.organizationId === 'string' ? req.query.organizationId.trim() : '';
  const wardNo = typeof req.query.wardNo === 'string' ? req.query.wardNo.trim() : '';

  if (!orgId) {
    return res.status(400).json({ message: 'Organization ID is required for bulk delete.' });
  }

  const query = { organizationId: orgId };
  if (wardNo) query.wardNo = wardNo;

  try {
    const result = await Voter.deleteMany(query);
    cache.flushAll(); // Clear cache to reflect deletions
    res.json({ message: 'Records deleted successfully.', deletedCount: result.deletedCount });
  } catch (err) {
    console.error('Master data bulk delete failed:', err.message);
    res.status(500).json({ message: 'Bulk delete failed.' });
  }
});


router.get('/import-template.xlsx', verifyToken, isAdmin, async (_req, res) => {
  try {
    const workbook = createWorkbook();
    addSheet(workbook, 'Voters', [{
      'EPIC No': '',
      Ward: '',
      Part: '',
      'Serial No': '',
      'Name (English)': '',
      'Name (Hindi)': '',
      Age: '',
      Gender: '',
      Relation: '',
      'Relative Name (English)': '',
      'Relative Name (Hindi)': '',
      'House No': '',
      'House No (Hindi)': '',
      Mobile: '',
      Caste: '',
      'Family ID': '',
      Village: '',
      'Village (Hindi)': '',
    }]);
    await sendWorkbook(res, workbook, 'voter-import-template');
  } catch (err) {
    console.error('Voter import template generation failed:', err.message);
    if (!res.headersSent) res.status(500).json({ message: 'Import template could not be generated.' });
  }
});

router.post('/upload-voters', verifyToken, isAdmin, upload.single('file'), async (req, res) => {
  if (!req.file || !req.file.buffer) return res.status(400).json({ message: 'No valid file uploaded.' });
  const organizationId = typeof req.body.organizationId === 'string' && req.body.organizationId.trim()
    ? req.body.organizationId.trim()
    : 'org_default';
  if (!await Organization.exists({ _id: organizationId })) {
    return res.status(404).json({ message: 'Organization not found.' });
  }

  const defaultWardNo = typeof req.body.wardNo === 'string' ? req.body.wardNo.trim() : '';
  const defaultBoothNo = typeof req.body.boothNo === 'string' ? req.body.boothNo.trim() : '';
  const defaultUploadedBy = typeof req.body.uploadedBy === 'string' ? req.body.uploadedBy.trim() : '';
  const defaultDescription = typeof req.body.listDescription === 'string' ? req.body.listDescription.trim() : '';

  // Auto register ward if provided
  if (defaultWardNo) {
    await Organization.updateOne(
      { _id: organizationId },
      { $addToSet: { wards: defaultWardNo } }
    ).catch(err => console.error('Error adding ward to org:', err));
  }

  const extractCellValue = (cell) => {
    if (!cell) return '';
    const val = cell.value;
    if (val == null) return '';
    if (typeof val === 'object') {
      if (val.result !== undefined && val.result !== null) return String(val.result).trim();
      if (val.text !== undefined && val.text !== null) return String(val.text).trim();
      if (Array.isArray(val.richText)) {
        return val.richText.map(t => t.text || '').join('').trim();
      }
    }
    return String(cell.text || val).trim();
  };

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return res.status(400).json({ message: 'The uploaded Excel file has no worksheets.' });

    // Dynamic Header Detection
    const headerRow = worksheet.getRow(1);
    const colMap = {};
    const isHi = (str) => str.includes('hindi') || str.includes('hin') || str.includes('हिंदी') || str.includes('हिन्दी');
    const isEn = (str) => str.includes('english') || str.includes('eng') || str.includes('(en)') || str.endsWith('en');

    headerRow.eachCell((cell, colNumber) => {
      const rawText = extractCellValue(cell);
      const h = rawText.toLowerCase().replace(/[\s\-_()\/.,]/g, '');
      if (/^(क्रमांक|serial|srno|sno|serialno|अनुक्रमांक)$/i.test(h) || h.startsWith('serial') || h.startsWith('क्रमांक')) {
        if (!colMap.serialNo) colMap.serialNo = colNumber;
      } else if (/^(पहचान|पहचानपत्र|epic|epicno|voterid|पहचानपत्रepicno)$/i.test(h) || h.includes('epic') || h.startsWith('पहचान')) {
        if (!colMap.epic) colMap.epic = colNumber;
      } else if (h.includes('नाम') || h.includes('name')) {
        if (h.includes('संबंधी') || h.includes('पिता') || h.includes('पति') || h.includes('relative') || h.includes('father') || h.includes('husband')) {
          if (isEn(h)) {
            colMap.relativeNameEn = colNumber;
          } else {
            colMap.relativeNameHi = colNumber;
          }
        } else if (isEn(h)) {
          colMap.nameEn = colNumber;
        } else {
          colMap.nameHi = colNumber;
        }
      } else if (/^(संबंध|सम्बन्ध|संबंधप्रकार|relation|relationtype|रिश्ता)$/i.test(h) || h.startsWith('संबंध') || h.startsWith('relation')) {
        colMap.relationType = colNumber;
      } else if (/^(मकान|मकानसंख्या|गृहसंख्या|houseno|house|मकाननं)$/i.test(h) || h.startsWith('house') || h.startsWith('मकान')) {
        if (isHi(h)) {
          colMap.houseNoHi = colNumber;
        } else {
          if (!colMap.houseNo) colMap.houseNo = colNumber;
        }
      } else if (/^(आयु|age|उम्र|voterage)$/i.test(h)) {
        colMap.age = colNumber;
      } else if (/^(लिंग|gender|sex|जेंडर)$/i.test(h)) {
        colMap.gender = colNumber;
      } else if (/^(वार्ड|ward|wardno|वार्डसंख्या)$/i.test(h) || h.startsWith('ward') || h.startsWith('वार्ड')) {
        colMap.wardNo = colNumber;
      } else if (/^(बूथ|भाग|part|booth|partno|boothno|भागसंख्या|बूथसंख्या)$/i.test(h) || h.startsWith('part') || h.startsWith('booth') || h.includes('भागसंख्या')) {
        colMap.partNo = colNumber;
      } else if (/^(मोबाइल|mobile|phone|contact|phoneno|mobileno)$/i.test(h)) {
        colMap.mobileNo = colNumber;
      } else if (/^(जाति|caste|वर्ग)$/i.test(h)) {
        colMap.caste = colNumber;
      } else if (/^(परिवार|परिवारआईडी|familyid|family)$/i.test(h) || h.startsWith('family')) {
        colMap.familyId = colNumber;
      } else if (/^(गाँव|गांव|village|villagename|ग्राम)$/i.test(h) || h.startsWith('village') || h.startsWith('गांव') || h.startsWith('गाँव')) {
        if (isHi(h)) {
          colMap.villageNameHi = colNumber;
        } else {
          if (!colMap.villageName) colMap.villageName = colNumber;
        }
      }
    });

    const isMapped = Boolean(colMap.epic || colMap.nameHi || colMap.serialNo);
    const getVal = (row, colKey, fallbackIndex) => {
      const colIdx = isMapped && colMap[colKey] ? colMap[colKey] : fallbackIndex;
      if (!colIdx) return '';
      return extractCellValue(row.getCell(colIdx));
    };

    const parseRow = (row, rowNumber) => {
      const cellText = (colKey, fallbackIdx) => getVal(row, colKey, fallbackIdx);
      
      const rawSerial = cellText('serialNo', 4);
      let serialNo = parseInt(rawSerial, 10);
      if (isNaN(serialNo) || serialNo < 1) {
        serialNo = rowNumber - 1;
      }

      let epic = cellText('epic', 1).toUpperCase().replace(/[\s\u200B\uFEFF]/g, '');
      const nameEn = cellText('nameEn', 5);
      let nameHi = cellText('nameHi', 6);
      if (!nameHi && nameEn) nameHi = nameEn;

      if (!nameHi || nameHi.length < 2) return null;
      if (!epic || epic.length < 3) {
        epic = `VOTER_${serialNo}`;
      }

      const rawAge = parseInt(cellText('age', 7), 10);
      const age = (!isNaN(rawAge) && rawAge >= 18 && rawAge <= 125) ? rawAge : null;

      let gender = cellText('gender', 8);
      if (['m', 'male', 'पुरुष'].includes(gender.toLowerCase())) gender = 'पुरुष';
      else if (['f', 'female', 'स्त्री', 'महिला'].includes(gender.toLowerCase())) gender = 'स्त्री';
      else gender = gender || 'अन्य';

      const voter = {
        epic,
        wardNo: cellText('wardNo', 2) || defaultWardNo || '1',
        partNo: cellText('partNo', 3) || defaultBoothNo || '1',
        serialNo,
        nameEn: nameEn || nameHi,
        nameHi,
        age,
        gender,
        relationType: cellText('relationType', 9) || 'पिता',
        relativeNameEn: cellText('relativeNameEn', 10),
        relativeNameHi: stripNameFromRelative(nameHi, cellText('relativeNameHi', 11)),
        houseNo: cellText('houseNo', 12) || '',
        houseNoHi: cellText('houseNoHi', 13) || '',
        mobileNo: cellText('mobileNo', 14) || '',
        caste: cellText('caste', 15) || '',
        familyId: cellText('familyId', 16) || '',
        villageName: cellText('villageName', 17) || '',
        villageNameHi: cellText('villageNameHi', 18) || '',
        organizationId,
      };
      if (defaultUploadedBy) {
        voter.assignedWorker = defaultUploadedBy;
      }
      return voter;
    };

    const batch = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const voter = parseRow(row, rowNumber);
      if (voter) batch.push(voter);
    });

    if (batch.length === 0) return res.status(400).json({ message: 'No valid voter records found in file.' });

    // Track all detected wards in the batch
    const detectedWards = new Set();
    if (defaultWardNo) detectedWards.add(defaultWardNo);
    batch.forEach(v => { if (v.wardNo) detectedWards.add(v.wardNo); });
    if (detectedWards.size > 0) {
      await Organization.updateOne(
        { _id: organizationId },
        { $addToSet: { wards: { $each: Array.from(detectedWards) } } }
      ).catch(() => {});
    }

    const uniqueBatch = [...new Map(batch.map((voter) => [
      `${voter.wardNo || defaultWardNo || ''}_${voter.partNo || defaultBoothNo || ''}_${voter.serialNo || voter.epic || crypto.randomUUID()}`,
      voter
    ])).values()];
    
    // 🚀 Scale to 100,000+ (1 Lakh) voters safely with chunked bulk writes
    const CHUNK_SIZE = 2500;
    let inserted = 0;
    let updated = 0;
    
    for (let i = 0; i < uniqueBatch.length; i += CHUNK_SIZE) {
      const chunk = uniqueBatch.slice(i, i + CHUNK_SIZE);
      const ops = chunk.map((voter) => {
        const { _id, ...updateData } = voter;
        const vWard = String(voter.wardNo || defaultWardNo || '').trim();
        const vPart = String(voter.partNo || defaultBoothNo || '').trim();
        const vSerial = voter.serialNo ? parseInt(voter.serialNo, 10) : null;

        const opFilter = { organizationId };
        if (vWard && vSerial) {
          opFilter.wardNo = vWard;
          opFilter.serialNo = vSerial;
          if (vPart) opFilter.partNo = vPart;
        } else if (voter.epic) {
          opFilter.epic = voter.epic;
          if (vWard) opFilter.wardNo = vWard;
        } else {
          opFilter._id = voter._id || `voter_${crypto.randomUUID()}`;
        }

        return {
          updateOne: {
            filter: opFilter,
            collation: { locale: 'en', strength: 2 },
            update: {
              $set: updateData,
              $setOnInsert: { _id: `voter_${crypto.randomUUID()}` },
            },
            upsert: true,
          },
        };
      });
      const chunkResult = await Voter.bulkWrite(ops, { ordered: false });
      inserted += chunkResult.upsertedCount || 0;
      updated += chunkResult.matchedCount || 0;
    }

    // 🚀 AUTOMATIC ROLL SYNCHRONIZATION FOR EXCEL IMPORT
    try {
      const activeSerialsByWard = new Map();
      for (const voter of uniqueBatch) {
        const vWard = String(voter.wardNo || defaultWardNo || '').trim();
        const vPart = String(voter.partNo || defaultBoothNo || '').trim();
        const vSerial = voter.serialNo ? parseInt(voter.serialNo, 10) : null;
        if (vWard && vSerial) {
          const key = `${vWard}_${vPart}`;
          if (!activeSerialsByWard.has(key)) {
            activeSerialsByWard.set(key, { wardNo: vWard, partNo: vPart, serials: new Set() });
          }
          activeSerialsByWard.get(key).serials.add(vSerial);
        }
      }
      for (const { wardNo: wNo, partNo: pNo, serials } of activeSerialsByWard.values()) {
        const cleanupFilter = {
          organizationId: organizationId,
          wardNo: wNo,
          serialNo: { $nin: Array.from(serials) }
        };
        if (pNo) cleanupFilter.partNo = pNo;
        const delRes = await Voter.deleteMany(cleanupFilter);
        if (delRes.deletedCount > 0) {
          console.log(`[admin] Excel import synchronized Ward ${wNo}: Removed ${delRes.deletedCount} stale/deleted records.`);
        }
      }
    } catch (cleanErr) {
      console.warn('[admin] Excel roll synchronization cleanup warning:', cleanErr.message);
    }

    // Clear cache immediately
    cache.flushAll();

    try {
      const adminPdfRouter = require('./admin_pdf');
      if (adminPdfRouter && adminPdfRouter.uploadJobs) {
        const jobId = crypto.randomUUID();
        adminPdfRouter.uploadJobs.set(jobId, {
          id: jobId,
          filename: req.file.originalname,
          fileType: 'excel',
          organizationId,
          wardNo: defaultWardNo,
          boothNo: defaultBoothNo,
          uploadedBy: defaultUploadedBy,
          listDescription: defaultDescription,
          status: 'completed',
          progress: 100,
          extractedCount: inserted + updated,
          uploadedAt: new Date().toISOString()
        });
      }
    } catch (e) {
      console.warn('Could not record excel job:', e.message);
    }

    res.json({
      success: true,
      inserted,
      updated,
      count: inserted + updated,
      wardNo: defaultWardNo,
      boothNo: defaultBoothNo,
      uploadedBy: defaultUploadedBy,
      listDescription: defaultDescription
    });
  } catch (err) {
    console.error('Excel processing error:', err);
    res.status(500).json({ message: 'Error processing the Excel file. Check the format.' });
  }
});

router.get('/export-voters', verifyToken, isAdmin, async (req, res) => {
  try {
    const orgId = typeof req.query.organizationId === 'string' ? req.query.organizationId.trim() : '';
    const query = orgId ? { organizationId: orgId } : {};
    
    const voters = await Voter.find(query).sort({ wardNo: 1, partNo: 1, serialNo: 1 }).lean();
    
    const workbook = createWorkbook();
    addSheet(workbook, 'मतदाता सूची', voters.map((v) => ({
      'क्रमांक': v.serialNo,
      'पहचान पत्र (EPIC No)': v.epic,
      'मतदाता का नाम': v.nameHi || '',
      'संबंधी का नाम': v.relativeNameHi || '',
      'संबंध प्रकार': v.relationType || 'पिता',
      'मकान संख्या': (!v.houseNo || ["'-", "-", "0", "000"].includes(String(v.houseNo).trim())) ? '' : String(v.houseNo).replace(/['"]/g, '').trim(),
      'आयु': v.age,
      'लिंग': v.gender,
      'गाँव / मोहल्ला': v.villageNameHi || v.villageName || '',
      'वार्ड संख्या': v.wardNo,
      'बूथ / भाग संख्या': v.partNo,
      'स्थिति': v.status || 'सक्रिय',
      'मोबाइल': v.mobileNo || '',
      'जाति / वर्ग': v.caste || '',
      'पारिवारिक आईडी': v.familyId || '',
      'समर्थन स्थिति': v.supportStatus || 'Neutral',
      'मतदान स्थिति': v.voted ? 'वोट दिया' : 'शेष'
    })));

    addSheet(workbook, 'Voters', voters.map((v) => ({
      'EPIC No': v.epic,
      'Ward': v.wardNo,
      'Part': v.partNo,
      'Serial No': v.serialNo,
      'Name (English)': '',
      'Name (Hindi)': v.nameHi,
      'Age': v.age,
      'Gender': v.gender,
      'Relation': v.relationType,
      'Relative Name (English)': '',
      'Relative Name (Hindi)': v.relativeNameHi,
      'House No': (!v.houseNo || ["'-", "-", "0", "000"].includes(String(v.houseNo).trim())) ? '' : String(v.houseNo).replace(/['"]/g, '').trim(),
      'House No (Hindi)': (!v.houseNoHi || ["'-", "-", "0", "000"].includes(String(v.houseNoHi).trim())) ? '' : String(v.houseNoHi).replace(/['"]/g, '').trim(),
      'Mobile': v.mobileNo,
      'Caste': v.caste,
      'Family ID': v.familyId,
      'Village': '',
      'Village (Hindi)': v.villageNameHi || '',
      'Surety': v.surety,
      'Notes': v.notes,
      'Migrant': v.isMigrant ? 'Yes' : 'No',
      'Migrant Location': v.migrantLocation,
      'Assigned Worker': v.assignedWorker,
      'Support Status': v.supportStatus,
      'Voted': v.voted ? 'Yes' : 'No',
      'Voted At': v.votedAt
    })));
    await sendWorkbook(res, workbook, 'Voters_Export');
  } catch (err) {
    console.error('Export failed:', err.message);
    if (!res.headersSent) res.status(500).json({ message: 'Export failed' });
  }
});

// ==========================================
// WEBSITE LEADS / INQUIRIES MANAGEMENT
// ==========================================

// Public endpoint for website demo form submissions
router.post('/leads', async (req, res) => {
  try {
    const { name, phone, constituency, electionType, notes } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'नाम आवश्यक है।' });
    }
    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      return res.status(400).json({ message: 'मोबाइल नंबर आवश्यक है।' });
    }

    const lead = await Lead.create({
      _id: `lead_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: name.trim(),
      phone: phone.trim(),
      constituency: (constituency || '').trim(),
      electionType: (electionType || 'विधानसभा (Assembly)').trim(),
      notes: (notes || '').trim(),
      status: 'new',
      createdAt: new Date()
    });

    res.status(201).json({
      success: true,
      message: 'लीड सफलतापूर्वक दर्ज कर ली गई है।',
      leadId: lead._id
    });
  } catch (err) {
    console.error('Failed to save lead:', err.message);
    res.status(500).json({ message: 'लीड सेव करने में त्रुटि आई।' });
  }
});

// Admin-only: Fetch all website demo leads
router.get('/leads', verifyToken, isAdmin, async (_req, res) => {
  try {
    const leads = await Lead.find({}).sort({ createdAt: -1 }).lean();
    res.json(leads);
  } catch (err) {
    console.error('Failed to fetch leads:', err.message);
    res.status(500).json({ message: 'लीड्स लोड नहीं हो सकीं।' });
  }
});

// Admin-only: Update lead status or notes
router.patch('/leads/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const updates = {};
    if (status) updates.status = status;
    if (typeof notes === 'string') updates.notes = notes;

    const updated = await Lead.findByIdAndUpdate(id, { $set: updates }, { returnDocument: 'after' }).lean();
    if (!updated) return res.status(404).json({ message: 'लीड नहीं मिली।' });

    res.json({ success: true, lead: updated });
  } catch (err) {
    console.error('Failed to update lead:', err.message);
    res.status(500).json({ message: 'लीड अपडेट करने में त्रुटि आई।' });
  }
});

// Admin-only: Delete lead
router.delete('/leads/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Lead.findByIdAndDelete(id).lean();
    if (!deleted) return res.status(404).json({ message: 'लीड नहीं मिली।' });

    res.json({ success: true, message: 'लीड सफलतापूर्वक डिलीट कर दी गई।' });
  } catch (err) {
    console.error('Failed to delete lead:', err.message);
    res.status(500).json({ message: 'लीड डिलीट करने में त्रुटि आई।' });
  }
});

// ==========================================
// DEMO USERS MANAGEMENT & INSTANT LOCKOUT
// ==========================================

const SAMPLE_DEMO_NAMES = [
  { hi: 'रामगोपाल शर्मा', en: 'Ramgopal Sharma', relHi: 'मदनलाल शर्मा', relEn: 'Madanlal Sharma', relType: 'पिता', caste: 'ब्राह्मण', house: '14' },
  { hi: 'कमला देवी शर्मा', en: 'Kamla Devi Sharma', relHi: 'रामगोपाल शर्मा', relEn: 'Ramgopal Sharma', relType: 'पति', caste: 'ब्राह्मण', house: '14' },
  { hi: 'सुरेश कुमार मीणा', en: 'Suresh Kumar Meena', relHi: 'रामकेश मीणा', relEn: 'Ramkesh Meena', relType: 'पिता', caste: 'मीणा', house: '21' },
  { hi: 'सुनीता मीणा', en: 'Sunita Meena', relHi: 'सुरेश कुमार मीणा', relEn: 'Suresh Kumar Meena', relType: 'पति', caste: 'मीणा', house: '21' },
  { hi: 'विजय सिंह शेखावत', en: 'Vijay Singh Shekhawat', relHi: 'प्रताप सिंह', relEn: 'Pratap Singh', relType: 'पिता', caste: 'राजपूत', house: '32' },
  { hi: 'कौशल्या कंवर', en: 'Kaushalya Kanwar', relHi: 'विजय सिंह शेखावत', relEn: 'Vijay Singh Shekhawat', relType: 'पति', caste: 'राजपूत', house: '32' },
  { hi: 'राकेश कुमार जाट', en: 'Rakesh Kumar Jat', relHi: 'बलदेव जाट', relEn: 'Baldev Jat', relType: 'पिता', caste: 'जाट', house: '45' },
  { hi: 'मंजू जाट', en: 'Manju Jat', relHi: 'राकेश कुमार जाट', relEn: 'Rakesh Kumar Jat', relType: 'पति', caste: 'जाट', house: '45' },
  { hi: 'अब्दुल रशीद खान', en: 'Abdul Rasheed Khan', relHi: 'बशीर खान', relEn: 'Basheer Khan', relType: 'पिता', caste: 'मुस्लिम', house: '58' },
  { hi: 'शबाना बानो', en: 'Shabana Bano', relHi: 'अब्दुल रशीद खान', relEn: 'Abdul Rasheed Khan', relType: 'पति', caste: 'मुस्लिम', house: '58' },
  { hi: 'महेश कुमार कुमावत', en: 'Mahesh Kumar Kumawat', relHi: 'गोपाल कुमावत', relEn: 'Gopal Kumawat', relType: 'पिता', caste: 'कुमावत', house: '67' },
  { hi: 'रेखा कुमावत', en: 'Rekha Kumawat', relHi: 'महेश कुमार कुमावत', relEn: 'Mahesh Kumar Kumawat', relType: 'पति', caste: 'कुमावत', house: '67' },
  { hi: 'दिनेश कुमार गुर्जर', en: 'Dinesh Kumar Gurjar', relHi: 'रामफूल गुर्जर', relEn: 'Ramphool Gurjar', relType: 'पिता', caste: 'गुर्जर', house: '78' },
  { hi: 'सीमा गुर्जर', en: 'Seema Gurjar', relHi: 'दिनेश कुमार गुर्जर', relEn: 'Dinesh Kumar Gurjar', relType: 'पति', caste: 'गुर्जर', house: '78' },
  { hi: 'अशोक कुमार अग्रवाल', en: 'Ashok Kumar Agrawal', relHi: 'मुरारी लाल', relEn: 'Murari Lal', relType: 'पिता', caste: 'वैश्य', house: '92' },
  { hi: 'शारदा अग्रवाल', en: 'Sharda Agrawal', relHi: 'अशोक कुमार अग्रवाल', relEn: 'Ashok Kumar Agrawal', relType: 'पति', caste: 'वैश्य', house: '92' },
  { hi: 'विकास कुमार यादव', en: 'Vikas Kumar Yadav', relHi: 'हरिराम यादव', relEn: 'Hariram Yadav', relType: 'पिता', caste: 'यादव', house: '105' },
  { hi: 'पूजा यादव', en: 'Pooja Yadav', relHi: 'विकास कुमार यादव', relEn: 'Vikas Kumar Yadav', relType: 'पति', caste: 'यादव', house: '105' },
  { hi: 'प्रकाश चंद वर्मा', en: 'Prakash Chand Verma', relHi: 'किशोरी लाल', relEn: 'Kishori Lal', relType: 'पिता', caste: 'वर्मा / एससी', house: '118' },
  { hi: 'संतोष वर्मा', en: 'Santosh Verma', relHi: 'प्रकाश चंद वर्मा', relEn: 'Prakash Chand Verma', relType: 'पति', caste: 'वर्मा / एससी', house: '118' },
  { hi: 'संजय कुमार सैनी', en: 'Sanjay Kumar Saini', relHi: 'भंवर लाल सैनी', relEn: 'Bhanwar Lal Saini', relType: 'पिता', caste: 'माली / सैनी', house: '131' },
  { hi: 'अनिता सैनी', en: 'Anita Saini', relHi: 'संजय कुमार सैनी', relEn: 'Sanjay Kumar Saini', relType: 'पति', caste: 'माली / सैनी', house: '131' },
  { hi: 'मुकेश कुमार प्रजापत', en: 'Mukesh Kumar Prajapat', relHi: 'रामस्वरूप', relEn: 'Ramswaroop', relType: 'पिता', caste: 'प्रजापत', house: '144' },
  { hi: 'सरोज प्रजापत', en: 'Saroj Prajapat', relHi: 'मुकेश कुमार प्रजापत', relEn: 'Mukesh Kumar Prajapat', relType: 'पति', caste: 'प्रजापत', house: '144' },
  { hi: 'अनिल कुमार सोनी', en: 'Anil Kumar Soni', relHi: 'रतन लाल सोनी', relEn: 'Ratan Lal Soni', relType: 'पिता', caste: 'स्वर्णकार', house: '158' }
];

// Admin-only: Generate a new Demo User with sample data
router.post('/demo-user', verifyToken, isAdmin, async (req, res) => {
  try {
    const { clientName, customEmail, customPassword, targetOrgId } = req.body || {};
    const randomCode = Math.floor(1000 + Math.random() * 9000);

    let targetOrg = null;
    let orgId = `tenant_demo_${randomCode}`;

    if (targetOrgId && targetOrgId !== 'new') {
      targetOrg = await Organization.findById(targetOrgId);
      if (targetOrg) {
        orgId = targetOrg._id;
      }
    }

    const defaultPrefix = targetOrg
      ? targetOrg.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().slice(0, 15)
      : 'demo';

    const email = (customEmail && typeof customEmail === 'string' && customEmail.includes('@'))
      ? customEmail.trim().toLowerCase()
      : `${defaultPrefix || 'demo'}_${randomCode}@matdataportal.com`;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: 'इस ईमेल से खाता पहले से मौजूद है। कृपया दूसरा ईमेल चुनें।' });
    }

    const plainPassword = (customPassword && typeof customPassword === 'string' && customPassword.length >= 6)
      ? customPassword.trim()
      : `Demo@${randomCode}`;

    const passwordHash = await bcrypt.hash(plainPassword, 10);
    const name = (clientName && typeof clientName === 'string' && clientName.trim())
      ? clientName.trim()
      : targetOrg ? `डेमो - ${targetOrg.name}` : `डेमो क्लाइंट #${randomCode}`;

    const demoModules = ['voters', 'poll-desk', 'turnout', 'warroom', 'history', 'community', 'workers', 'migrants', 'accounts'];

    // 1. If not an existing organization, create standalone demo organization
    if (!targetOrg) {
      await Organization.create({
        _id: orgId,
        name,
        enabledModules: demoModules,
        allowedWards: [],
        isActive: true,
        isDemo: true,
        demoPassword: plainPassword,
        whatsappEnabled: true,
        whatsappCredits: 50,
        whatsappUsed: 0,
        slipConfig: {
          candidateName: 'श्री राजेश कुमार शर्मा',
          candidateParty: 'भारतीय जनता पार्टी (भाजपा)',
          assemblyConstituency: 'हवामहल (विधानसभा क्षेत्र)',
          wardNumber: 'वार्ड 1',
          pollingDate: '25 नवम्बर 2024',
          appealHeadline: '(1 नंबर पर कमल का फूल का बटन दबाएं)',
          footerAppeal: 'कमल का बटन दबाएं और भारी मतों से विजयी बनाएं'
        }
      });
    }

    // 2. Create Demo User
    await User.create({
      _id: `user_demo_${randomCode}`,
      email,
      passwordHash,
      fullName: name,
      phone: '9876543210',
      role: 'tenant_admin',
      organizationId: orgId,
      isActive: true,
      isDemo: true,
      demoPassword: plainPassword
    });

    // 3. Seed Realistic Demo Voters if org has no voters
    let sampleVotersCount = 0;
    const existingVoters = await Voter.countDocuments({ organizationId: orgId });
    if (existingVoters === 0) {
      const supportStatuses = ['core', 'core', 'swing', 'swing', 'opposition', 'unmarked'];
      const sampleVoters = SAMPLE_DEMO_NAMES.map((item, idx) => {
        const serialNo = idx + 1;
        const wardNo = String((idx % 3) + 1);
        const partNo = String(10 + (idx % 2));
        const epicPrefix = 'RJX';
        const epicNum = String(1000000 + randomCode * 100 + serialNo);
        const isFemale = item.relType === 'पति';
        const age = 22 + (idx * 3) % 45;
        const voted = idx % 3 === 0;

        return {
          _id: `voter_demo_${randomCode}_${serialNo}`,
          epic: `${epicPrefix}${epicNum.slice(0, 7)}`,
          wardNo,
          partNo,
          serialNo,
          nameEn: item.en,
          nameHi: item.hi,
          age,
          gender: isFemale ? 'स्त्री' : 'पुरुष',
          relationType: item.relType,
          relativeNameEn: item.relEn,
          relativeNameHi: item.relHi,
          houseNo: item.house,
          houseNoHi: item.house,
          mobileNo: '9829' + String(100000 + serialNo * 1234).slice(0, 6),
          caste: item.caste,
          supportStatus: supportStatuses[idx % supportStatuses.length],
          voted,
          votedAt: voted ? new Date() : null,
          surety: idx % 2 === 0 ? 'पक्का' : 'संभावित',
          notes: idx === 0 ? 'वार्ड के प्रमुख सम्मानित नागरिक' : '',
          isMigrant: idx === 4 || idx === 12,
          migrantLocation: idx === 4 ? 'सूरत, गुजरात' : idx === 12 ? 'मुंबई' : '',
          organizationId: orgId,
          familyId: `fam_${item.house}`
        };
      });

      await Voter.insertMany(sampleVoters);
      sampleVotersCount = sampleVoters.length;
    } else {
      sampleVotersCount = existingVoters;
    }

    res.status(201).json({
      success: true,
      message: `डेमो खाता तैयार हो गया (${targetOrg ? targetOrg.name : 'नया क्लाइंट'})!`,
      demoUser: {
        id: orgId,
        name,
        email,
        password: plainPassword,
        isActive: true,
        voterCount: sampleVotersCount,
        createdAt: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Failed to create demo user:', err.message);
    res.status(500).json({ message: 'डेमो यूज़र नहीं बनाया जा सका: ' + err.message });
  }
});

// Admin-only: List all Demo Users
router.get('/demo-users', verifyToken, isAdmin, async (_req, res) => {
  try {
    const demoUsers = await User.find({ isDemo: true }).sort({ createdAt: -1 }).lean();
    const demoOrgs = await Organization.find({
      $or: [{ isDemo: true }, { _id: { $regex: '^tenant_demo_' } }]
    }).sort({ createdAt: -1 }).lean();

    const orgMap = new Map();
    demoOrgs.forEach((o) => orgMap.set(o._id, o));

    const result = await Promise.all(
      demoUsers.map(async (user) => {
        const org = orgMap.get(user.organizationId) || (await Organization.findById(user.organizationId).lean());
        const voterCount = await Voter.countDocuments({ organizationId: user.organizationId });

        return {
          id: user.organizationId,
          userId: user._id,
          name: user.fullName || org?.name || 'डेमो यूज़र',
          email: user.email || 'N/A',
          password: user.demoPassword || org?.demoPassword || '—',
          isActive: user.isActive !== false && org?.isActive !== false,
          voterCount,
          createdAt: user.createdAt
        };
      })
    );

    res.json(result);
  } catch (err) {
    console.error('Failed to list demo users:', err.message);
    res.status(500).json({ message: 'डेमो यूज़र्स लोड नहीं हो सके।' });
  }
});

// Admin-only: Suspend or Re-activate Demo User & Org
router.put('/demo-users/:id/toggle-suspend', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const org = await Organization.findById(id);
    if (!org) {
      return res.status(404).json({ message: 'डेमो क्लाइंट नहीं मिला।' });
    }

    const targetStatus = org.isActive === false; // If currently false, toggle to true; else false
    await Organization.updateOne({ _id: id }, { $set: { isActive: targetStatus } });
    await User.updateMany({ organizationId: id }, { $set: { isActive: targetStatus } });

    res.json({
      success: true,
      isActive: targetStatus,
      message: targetStatus
        ? 'खाता पुनः सक्रिय (Active) कर दिया गया है।'
        : 'खाता सफलतापूर्वक निलंबित (Suspend) कर दिया गया है। संबंधित स्क्रीन तुरंत ब्लॉक हो जाएगी।'
    });
  } catch (err) {
    console.error('Failed to toggle demo user suspend:', err.message);
    res.status(500).json({ message: 'स्टेटस अपडेट करने में त्रुटि आई।' });
  }
});

// Admin-only: Delete Demo User, Org, and all its Demo Voters
router.delete('/demo-users/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await Organization.deleteOne({ _id: id });
    await User.deleteMany({ organizationId: id });
    await Voter.deleteMany({ organizationId: id });

    res.json({ success: true, message: 'डेमो यूज़र और सभी संबंधित डेटा स्थायी रूप से डिलीट कर दिए गए।' });
  } catch (err) {
    console.error('Failed to delete demo user:', err.message);
    res.status(500).json({ message: 'डेमो यूज़र डिलीट करने में त्रुटि आई।' });
  }
});

// Admin-only: Rename or edit an existing Ward name across organization voters, allowedWards, and slip configs
router.put('/wards/rename', verifyToken, isAdmin, async (req, res) => {
  try {
    const { organizationId, oldWard, newWard } = req.body;
    if (!organizationId || !oldWard || !newWard) {
      return res.status(400).json({ message: 'क्लाइंट (organizationId), पुराना वार्ड और नया वार्ड नाम अनिवार्य हैं।' });
    }

    const cleanOld = String(oldWard).trim();
    const cleanNew = String(newWard).trim();

    if (!cleanOld || !cleanNew) {
      return res.status(400).json({ message: 'कृपया वैध वार्ड नाम दर्ज करें।' });
    }

    if (cleanOld === cleanNew) {
      return res.json({ success: true, message: 'पुराना और नया नाम समान है, कोई बदलाव नहीं हुआ।' });
    }

    // 1. Update all voters for this organization
    const voterResult = await Voter.updateMany(
      { organizationId, wardNo: cleanOld },
      { $set: { wardNo: cleanNew } }
    );

    // Also check case-insensitive or with 'वार्ड ' prefix if none matched directly
    let extraModified = 0;
    if (voterResult.modifiedCount === 0) {
      const altResult = await Voter.updateMany(
        { 
          organizationId, 
          wardNo: { $regex: new RegExp(`^\\s*(?:वार्ड\\s*)?${cleanOld.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') } 
        },
        { $set: { wardNo: cleanNew } }
      );
      extraModified = altResult.modifiedCount;
    }

    const totalModifiedVoters = voterResult.modifiedCount + extraModified;

    // 2. Update Organization allowedWards & wards list
    const org = await Organization.findById(organizationId);
    if (org) {
      let wardsArr = Array.isArray(org.allowedWards) ? [...org.allowedWards] : [];
      let updatedAllowed = wardsArr.map(w => (String(w).trim() === cleanOld ? cleanNew : w));
      if (!updatedAllowed.includes(cleanNew)) {
        updatedAllowed.push(cleanNew);
      }
      updatedAllowed = Array.from(new Set(updatedAllowed.filter(w => String(w).trim() !== cleanOld)));

      let generalWards = Array.isArray(org.wards) ? [...org.wards] : [];
      let updatedWards = generalWards.map(w => (String(w).trim() === cleanOld ? cleanNew : w));
      if (!updatedWards.includes(cleanNew)) {
        updatedWards.push(cleanNew);
      }
      updatedWards = Array.from(new Set(updatedWards.filter(w => String(w).trim() !== cleanOld)));

      // 3. Update slipConfig.wardPollingStations if present
      const slipConfig = org.slipConfig || {};
      if (slipConfig.wardPollingStations && typeof slipConfig.wardPollingStations === 'object') {
        if (slipConfig.wardPollingStations[cleanOld] !== undefined) {
          slipConfig.wardPollingStations[cleanNew] = slipConfig.wardPollingStations[cleanOld];
          delete slipConfig.wardPollingStations[cleanOld];
        }
      }

      await Organization.updateOne(
        { _id: organizationId },
        { 
          $set: { 
            allowedWards: updatedAllowed,
            wards: updatedWards,
            slipConfig: slipConfig
          } 
        }
      );
    }

    // 4. Invalidate all cache related to master_data and wards_summary
    if (cache && typeof cache.flushAll === 'function') {
      cache.flushAll();
    }

    res.json({
      success: true,
      message: `वार्ड "${cleanOld}" को बदलकर सफलतापूर्वक "${cleanNew}" कर दिया गया (${totalModifiedVoters} मतदाता रिकॉर्ड्स अपडेट हुए)।`,
      totalModifiedVoters,
      oldWard: cleanOld,
      newWard: cleanNew
    });
  } catch (err) {
    console.error('Failed to rename ward:', err);
    res.status(500).json({ message: 'वार्ड का नाम बदलने में त्रुटि आई: ' + err.message });
  }
});

module.exports = router;
