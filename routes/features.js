const express = require('express');
const { verifyToken, requireModule } = require('../middleware/authMiddleware');
const { addVoterAccess, getEffectiveOrgId } = require('../lib/access');
const { createWorkbook, addSheet, sendWorkbook } = require('../lib/xlsx');
const { Voter, Organization, SlipDispatch, User, SystemSetting } = require('../models/index');
const cache = require('../lib/cache');

const router = express.Router();

const formatVoter = (row) => ({
  _id: row._id,
  sqlId: row.sqlId,
  epic: row.epic,
  nameEn: row.nameEn,
  nameHi: row.nameHi,
  relativeNameEn: row.relativeNameEn,
  relativeNameHi: row.relativeNameHi,
  relationType: row.relationType,
  age: row.age,
  gender: row.gender,
  houseNo: row.houseNo ? String(row.houseNo).replace(/^0+(\d+)/, '$1') : '',
  wardNo: row.wardNo,
  partNo: row.partNo,
  serialNo: row.serialNo,
  phone: row.mobileNo,
  caste: row.caste,
  surety: row.surety,
  supportStatus: row.supportStatus,
  isMigrant: row.isMigrant,
  migrantLocation: row.migrantLocation,
  assignedWorker: row.assignedWorker,
  familyId: row.familyId,
  voted: row.voted,
  photoUrl: row.photoUrl || '',
});

const boundedNumber = (value, fallback, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

const { escapeRegex, safeRegex } = require('../lib/regexUtils');

router.use(verifyToken);

router.get('/war-room', requireModule('warroom'), async (req, res) => {
  try {
    const match = addVoterAccess(req);

    const [supportResult, boothsResult] = await Promise.all([
      Voter.aggregate([
        { $match: match },
        { $group: { _id: "$supportStatus", count: { $sum: 1 } } }
      ]),
      Voter.aggregate([
        { $match: match },
        { $group: {
            _id: { wardNo: "$wardNo", partNo: "$partNo" },
            total: { $sum: 1 },
            voted: { $sum: { $cond: ["$voted", 1, 0] } },
            core: { $sum: { $cond: [{ $eq: ["$supportStatus", "core"] }, 1, 0] } },
            swing: { $sum: { $cond: [{ $eq: ["$supportStatus", "swing"] }, 1, 0] } },
            opposition: { $sum: { $cond: [{ $eq: ["$supportStatus", "opposition"] }, 1, 0] } },
            unmarked: { $sum: { $cond: [{ $in: ["$supportStatus", ["core", "swing", "opposition"]] }, 0, 1] } }
        }},
        { $project: {
            wardNo: "$_id.wardNo",
            partNo: "$_id.partNo",
            total: 1,
            voted: 1,
            core: 1,
            swing: 1,
            opposition: 1,
            unmarked: 1,
            _id: 0
        }},
        { $sort: { wardNo: 1, partNo: 1 } }
      ])
    ]);

    const metrics = { total: 0, voted: 0, core: 0, swing: 0, opposition: 0, unmarked: 0 };
    supportResult.forEach((row) => {
     const status = ['core', 'swing', 'opposition', 'unmarked'].includes(row._id) ? row._id : 'unmarked';
     metrics[status] += row.count;
     metrics.total += row.count;
    });
    metrics.voted = boothsResult.reduce((sum, row) => sum + row.voted, 0);

    const support = ['core', 'swing', 'opposition', 'unmarked'].map((status) => ({
     status,
     count: metrics[status],
    }));
    const booths = boothsResult.map((booth) => ({
     ...booth,
     ward: booth.wardNo || '',
     part: booth.partNo || '',
    }));

    res.json({ metrics, support, booths });
  } catch (err) {
    console.error('War room analytics failed:', err.message);
    res.status(500).json({ message: 'War room data could not be loaded.' });
  }
});

router.get('/dashboard', async (req, res) => {
  try {
    const match = addVoterAccess(req);

    const [aggregateResult, distinctWards, dispatchesCount, migrantCount] = await Promise.all([
      Voter.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            voted: { $sum: { $cond: ["$voted", 1, 0] } }
          }
        }
      ]),
      Voter.distinct('wardNo', match),
      SlipDispatch.countDocuments(match.organizationId ? { organizationId: match.organizationId } : {}),
      Voter.countDocuments({ ...match, isMigrant: true })
    ]);

    const totalVoters = aggregateResult[0]?.total || 0;
    const votedCount = aggregateResult[0]?.voted || 0;
    const cleanWards = (distinctWards || []).filter(w => w !== null && w !== undefined && String(w).trim() !== '');
    const wardCount = cleanWards.length;
    const turnoutPercent = totalVoters > 0 ? Number(((votedCount / totalVoters) * 100).toFixed(1)) : 0;

    const stats = {
      totalVoters,
      votedCount,
      turnoutPercent,
      wardCount,
      dispatchesCount,
      migrantCount
    };

    res.json(stats);
  } catch (err) {
    console.error('Dashboard data failed:', err.message);
    res.status(500).json({ message: 'Dashboard data could not be loaded.' });
  }
});

router.get('/migrants', requireModule('migrants'), async (req, res) => {
  try {
    const page = boundedNumber(req.query.page, 1, 1000);
    const pageSize = boundedNumber(req.query.pageSize, 100, 250);
    const votedStatus = typeof req.query.votedStatus === 'string' ? req.query.votedStatus.trim().toLowerCase() : 'all';
    const isExport = req.query.export === 'excel' || req.query.export === 'true';

    const query = addVoterAccess(req);
    query.isMigrant = true;

    if (typeof req.query.ward === 'string' && req.query.ward.trim()) {
      const wardRegex = safeRegex(req.query.ward);
      if (wardRegex) query.wardNo = wardRegex;
    }
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      const searchRegex = safeRegex(req.query.search);
      if (searchRegex) {
        query.$or = [
          { nameHi: searchRegex },
          { nameEn: searchRegex },
          { epic: searchRegex },
          { migrantLocation: searchRegex },
          { mobileNo: searchRegex },
        ];
      }
    }

    // Voting status filter
    if (votedStatus === 'voted') {
      query.voted = true;
    } else if (votedStatus === 'pending') {
      query.$and = query.$and || [];
      query.$and.push({
        $or: [{ voted: false }, { voted: { $exists: false } }, { voted: null }]
      });
    }

    // Base match query for overall metrics (independent of active filter)
    const metricsMatch = addVoterAccess(req);
    metricsMatch.isMigrant = true;
    if (typeof req.query.ward === 'string' && req.query.ward.trim()) {
      const wardRegex = safeRegex(req.query.ward);
      if (wardRegex) metricsMatch.wardNo = wardRegex;
    }

    const [totalMigrants, votedMigrants, famAgg, voters, filteredCount] = await Promise.all([
      Voter.countDocuments(metricsMatch),
      Voter.countDocuments({ ...metricsMatch, voted: true }),
      Voter.aggregate([
        { $match: metricsMatch },
        {
          $group: {
            _id: {
              $cond: [
                { $and: [{ $ifNull: ["$familyId", false] }, { $ne: ["$familyId", ""] }] },
                "$familyId",
                { $concat: [{ $ifNull: ["$wardNo", ""] }, "-", { $ifNull: ["$partNo", ""] }, "-", { $ifNull: ["$houseNo", ""] }] }
              ]
            }
          }
        }
      ]),
      isExport
        ? Voter.find(query).sort({ wardNo: 1, partNo: 1, serialNo: 1 }).lean()
        : Voter.find(query)
            .sort({ wardNo: 1, partNo: 1, serialNo: 1 })
            .skip((page - 1) * pageSize)
            .limit(pageSize)
            .lean(),
      Voter.countDocuments(query)
    ]);

    const metrics = {
      total: totalMigrants,
      voted: votedMigrants,
      pending: totalMigrants - votedMigrants,
      families: famAgg.length,
      turnout: totalMigrants > 0 ? Number(((votedMigrants / totalMigrants) * 100).toFixed(1)) : 0,
    };

    if (isExport) {
      const workbook = createWorkbook();
      const headers = [
        'क्र.सं.',
        'मतदाता का नाम',
        'संबंधी का नाम',
        'संबंध',
        'लिंग',
        'आयु',
        'वार्ड नं.',
        'भाग नं.',
        'मकान नं.',
        'पहचान पत्र (EPIC)',
        'मोबाइल नंबर',
        'वर्तमान स्थान (प्रवासी)',
        'मतदान स्थिति'
      ];
      const rows = voters.map((v, idx) => [
        idx + 1,
        v.nameHi || v.nameEn || '',
        v.relativeNameHi || v.relativeNameEn || '',
        v.relationType || '',
        v.gender || '',
        v.age || '',
        v.wardNo || '',
        v.partNo || '',
        v.houseNo || '',
        v.epic || '',
        v.mobileNo || '',
        v.migrantLocation || 'दर्ज नहीं',
        v.voted ? 'मतदान दर्ज' : 'मतदान बाकी'
      ]);
      addSheet(workbook, 'Migrant_Voters', headers, rows);
      return sendWorkbook(res, `Migrant_Voters_${Date.now()}.xlsx`, workbook);
    }

    res.json({
      data: voters.map(formatVoter),
      metrics,
      page,
      pageSize,
      total: filteredCount,
    });
  } catch (err) {
    console.error('Migrant search failed:', err.message);
    res.status(500).json({ message: 'Migrant records could not be loaded.' });
  }
});

// Caste Breakdown & Polling Tracker Endpoint
router.get('/caste-breakdown', requireModule('community', 'voters'), async (req, res) => {
  try {
    const orgId = getEffectiveOrgId(req);
    const userId = req.user?.id;

    // 1. Fetch configured caste options for this client
    let configuredCastes = [];
    if (orgId) {
      const orgDoc = await Organization.findById(orgId).select('casteOptions settings').lean();
      if (orgDoc && Array.isArray(orgDoc.casteOptions) && orgDoc.casteOptions.length > 0) {
        configuredCastes = orgDoc.casteOptions;
      } else if (orgDoc && orgDoc.settings && Array.isArray(orgDoc.settings.casteOptions) && orgDoc.settings.casteOptions.length > 0) {
        configuredCastes = orgDoc.settings.casteOptions;
      }
    }
    if (configuredCastes.length === 0 && userId) {
      const userDoc = await User.findById(userId).select('casteOptions').lean();
      if (userDoc && Array.isArray(userDoc.casteOptions) && userDoc.casteOptions.length > 0) {
        configuredCastes = userDoc.casteOptions;
      }
    }
    if (configuredCastes.length === 0) {
      const globalSetting = await SystemSetting.findById('caste_options').lean();
      if (globalSetting && Array.isArray(globalSetting.value) && globalSetting.value.length > 0) {
        configuredCastes = globalSetting.value;
      }
    }

    // 2. Build match query for voters of this client
    const matchQuery = addVoterAccess(req);
    if (typeof req.query.ward === 'string' && req.query.ward.trim()) {
      const wardRegex = safeRegex(req.query.ward);
      if (wardRegex) matchQuery.wardNo = wardRegex;
    }

    // 3. Aggregate counts grouped by caste and voted status, including family keys
    const agg = await Voter.aggregate([
      { $match: matchQuery },
      {
        $project: {
          caste: { $trim: { input: { $ifNull: ["$caste", ""] } } },
          voted: { $cond: ["$voted", true, false] },
          famKey: {
            $cond: [
              { $and: [{ $ifNull: ["$familyId", false] }, { $ne: ["$familyId", ""] }] },
              "$familyId",
              { $concat: [{ $ifNull: ["$wardNo", ""] }, "-", { $ifNull: ["$partNo", ""] }, "-", { $ifNull: ["$houseNo", ""] }] }
            ]
          }
        }
      },
      {
        $group: {
          _id: {
            caste: "$caste",
            voted: "$voted"
          },
          count: { $sum: 1 },
          famKeys: { $addToSet: "$famKey" }
        }
      }
    ]);

    // Also get distinct non-empty castes present in DB for this client
    const dbCastes = await Voter.distinct('caste', matchQuery);
    const validDbCastes = dbCastes
      .filter((c) => typeof c === 'string' && c.trim() && c.trim() !== 'अन्य' && c.trim() !== 'Other' && c.trim() !== 'unknown')
      .map((c) => c.trim());

    // Merge configured + valid DB castes into an ordered unique list
    const combinedCastes = Array.from(new Set([...configuredCastes, ...validDbCastes]));
    const configuredSet = new Set(combinedCastes.map((c) => c.toLowerCase()));

    // Map aggregated counts and family sets
    const casteCountMap = new Map();
    let otherVoted = 0;
    let otherPending = 0;
    const otherFamSet = new Set();
    const globalFamSet = new Set();
    let totalAllVoters = 0;
    let totalAllVoted = 0;

    for (const item of agg) {
      const rawCaste = (item._id?.caste || '').trim();
      const isVoted = Boolean(item._id?.voted);
      const cnt = item.count || 0;
      const fKeys = Array.isArray(item.famKeys) ? item.famKeys : [];
      totalAllVoters += cnt;
      if (isVoted) totalAllVoted += cnt;
      fKeys.forEach((k) => globalFamSet.add(k));

      if (!rawCaste || rawCaste === 'अन्य' || rawCaste.toLowerCase() === 'other' || !configuredSet.has(rawCaste.toLowerCase())) {
        if (isVoted) otherVoted += cnt;
        else otherPending += cnt;
        fKeys.forEach((k) => otherFamSet.add(k));
      } else {
        const lowerKey = rawCaste.toLowerCase();
        if (!casteCountMap.has(lowerKey)) {
          casteCountMap.set(lowerKey, { voted: 0, pending: 0, famSet: new Set() });
        }
        const entry = casteCountMap.get(lowerKey);
        if (isVoted) entry.voted += cnt;
        else entry.pending += cnt;
        fKeys.forEach((k) => entry.famSet.add(k));
      }
    }

    // Build the caste cards list with families count
    const castes = combinedCastes.map((name) => {
      const entry = casteCountMap.get(name.toLowerCase()) || { voted: 0, pending: 0, famSet: new Set() };
      const total = entry.voted + entry.pending;
      const turnout = total > 0 ? Number(((entry.voted / total) * 100).toFixed(1)) : 0;
      return {
        name,
        total,
        families: entry.famSet.size,
        voted: entry.voted,
        pending: entry.pending,
        turnout,
      };
    });

    // Sort castes by total voters descending so highest populated castes appear first
    castes.sort((a, b) => b.total - a.total);

    const otherTotal = otherVoted + otherPending;
    const otherTurnout = otherTotal > 0 ? Number(((otherVoted / otherTotal) * 100).toFixed(1)) : 0;
    const other = {
      name: 'अन्य',
      total: otherTotal,
      families: otherFamSet.size,
      voted: otherVoted,
      pending: otherPending,
      turnout: otherTurnout,
    };

    const totalAllPending = totalAllVoters - totalAllVoted;
    const overallTurnout = totalAllVoters > 0 ? Number(((totalAllVoted / totalAllVoters) * 100).toFixed(1)) : 0;

    res.json({
      summary: {
        totalCastes: castes.length + (otherTotal > 0 ? 1 : 0),
        configuredCastesCount: castes.length,
        totalFamilies: globalFamSet.size,
        totalVoters: totalAllVoters,
        totalVoted: totalAllVoted,
        totalPending: totalAllPending,
        overallTurnout,
      },
      castes,
      other,
    });
  } catch (err) {
    console.error('Caste breakdown aggregation failed:', err.message);
    res.status(500).json({ message: 'जातिगत समीकरण आंकड़े लोड नहीं हो सके।' });
  }
});

router.get('/community', requireModule('community'), async (req, res) => {
  try {
    const casteParam = typeof req.query.caste === 'string' ? req.query.caste.trim() : '';
    const votedStatus = typeof req.query.votedStatus === 'string' ? req.query.votedStatus.trim().toLowerCase() : 'all';
    const searchString = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const ward = typeof req.query.ward === 'string' ? req.query.ward.trim() : '';
    const includeFamily = req.query.includeFamily !== 'false';
    const isExport = req.query.export === 'excel' || req.query.export === 'true';

    const matchQuery = addVoterAccess(req);

    if (ward) {
      matchQuery.wardNo = new RegExp(escapeRegex(ward), 'i');
    }

    // 1. Caste filter
    if (casteParam) {
      if (casteParam === '__OTHER__' || casteParam === 'अन्य' || casteParam.toLowerCase() === 'other') {
        const orgId = getEffectiveOrgId(req);
        let configured = [];
        if (orgId) {
          const org = await Organization.findById(orgId).select('casteOptions settings').lean();
          if (org?.casteOptions?.length) configured = org.casteOptions;
          else if (org?.settings?.casteOptions?.length) configured = org.settings.casteOptions;
        }
        matchQuery.$or = [
          { caste: { $in: ['', null, 'अन्य', 'Other', 'unknown'] } },
          { caste: { $exists: false } },
          ...(configured.length > 0 ? [{ caste: { $nin: configured } }] : [])
        ];
      } else {
        matchQuery.caste = new RegExp('^' + escapeRegex(casteParam) + '$', 'i');
      }
    } else if (searchString) {
      const terms = searchString.split(',').map((t) => t.trim()).filter(Boolean);
      if (terms.length > 0) {
        const orConditions = [];
        terms.forEach((t) => {
          const rx = new RegExp(escapeRegex(t), 'i');
          orConditions.push({ caste: rx });
          orConditions.push({ nameEn: rx });
          orConditions.push({ nameHi: rx });
          orConditions.push({ relativeNameEn: rx });
          orConditions.push({ relativeNameHi: rx });
        });
        matchQuery.$or = orConditions;
      }
    }

    // 2. Voted status filter
    if (votedStatus === 'voted') {
      matchQuery.voted = true;
    } else if (votedStatus === 'pending') {
      matchQuery.$and = matchQuery.$and || [];
      matchQuery.$and.push({
        $or: [{ voted: false }, { voted: { $exists: false } }, { voted: null }]
      });
    }

    let finalVoters = await Voter.find(matchQuery).lean();

    // Include family if requested and not restricted to a specific caste or votedStatus
    if (includeFamily && finalVoters.length > 0 && !casteParam && votedStatus === 'all' && searchString) {
      const familyIds = [...new Set(finalVoters.map((v) => v.familyId).filter(Boolean))];
      if (familyIds.length > 0) {
        const accessQuery = addVoterAccess(req);
        accessQuery.familyId = { $in: familyIds };
        const familyVoters = await Voter.find(accessQuery).lean();
        const voterMap = new Map();
        familyVoters.forEach((v) => voterMap.set(v._id.toString(), v));
        finalVoters.forEach((v) => voterMap.set(v._id.toString(), v));
        finalVoters = Array.from(voterMap.values());
      }
    }

    // Sort by ward, part, serial
    finalVoters.sort((a, b) => {
      if (a.wardNo !== b.wardNo) return (a.wardNo || '').localeCompare(b.wardNo || '');
      if (a.partNo !== b.partNo) return (a.partNo || '').localeCompare(b.partNo || '');
      return (a.serialNo || 0) - (b.serialNo || 0);
    });

    // 3. Excel Export
    if (isExport) {
      const workbook = createWorkbook();
      const headers = [
        'क्र.सं.',
        'मतदाता का नाम',
        'संबंधी का नाम',
        'संबंध',
        'लिंग',
        'आयु',
        'वार्ड नं.',
        'भाग नं.',
        'मकान नं.',
        'पहचान पत्र (EPIC)',
        'मोबाइल नंबर',
        'जाति',
        'मतदान स्थिति'
      ];
      const rows = finalVoters.map((v, idx) => [
        idx + 1,
        v.nameHi || v.nameEn || '',
        v.relativeNameHi || v.relativeNameEn || '',
        v.relationType || '',
        v.gender || '',
        v.age || '',
        v.wardNo || '',
        v.partNo || '',
        v.houseNo || '',
        v.epic || '',
        v.mobileNo || '',
        v.caste || 'अन्य',
        v.voted ? 'मतदान दर्ज' : 'मतदान बाकी'
      ]);
      addSheet(workbook, 'Caste_Voters', headers, rows);
      const filename = `Caste_Voters_${casteParam || 'Report'}_${Date.now()}.xlsx`;
      return sendWorkbook(res, filename, workbook);
    }

    const page = boundedNumber(req.query.page, 1, 1000);
    const pageSize = boundedNumber(req.query.pageSize, 100, 500);

    const paginated = req.query.page || req.query.pageSize
      ? finalVoters.slice((page - 1) * pageSize, page * pageSize)
      : finalVoters;

    res.json(req.query.page || req.query.pageSize
      ? { data: paginated.map(formatVoter), page, pageSize, total: finalVoters.length }
      : finalVoters.map(formatVoter));
  } catch (err) {
    console.error('Community search failed:', err.message);
    res.status(500).json({ message: 'Community search could not be completed.' });
  }
});

router.get('/dispatches', requireModule('history'), async (req, res) => {
  try {
    const query = {};
    const targetOrgId = getEffectiveOrgId(req);
    if (targetOrgId) {
      query.organizationId = targetOrgId;
    }

    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      if (req.query.search.trim().length > 150) return res.status(400).json({ message: 'Search must be 150 characters or fewer.' });
      const search = new RegExp(escapeRegex(req.query.search.trim()), 'i');
      query.$or = [
        { voterName: search },
        { voterEpic: search },
        { recipientPhone: search },
      ];
    }
    if (typeof req.query.status === 'string' && req.query.status) {
      if (req.query.status === 'sent') {
        // Sirf asli mein gaya ho: verified Meta sent
        query.status = 'sent';
        query.dispatchType = { $ne: 'manual_whatsapp' };
      } else if (req.query.status === 'manual_link') {
        query.$or = [
          { dispatchType: 'manual_whatsapp' },
          { status: 'manual_link' }
        ];
      } else if (['failed', 'sending'].includes(req.query.status)) {
        query.status = req.query.status;
      } else {
        return res.status(400).json({ message: 'Choose a valid dispatch status.' });
      }
    }

    const page = boundedNumber(req.query.page, 1, 100000);
    const limit = boundedNumber(req.query.limit, 50, 200);

    const [dispatches, totalCount, statusSummary] = await Promise.all([
      SlipDispatch.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      SlipDispatch.countDocuments(query),
      SlipDispatch.aggregate([
        { $match: targetOrgId ? { organizationId: targetOrgId } : {} },
        {
          $group: {
            _id: {
              status: '$status',
              dispatchType: '$dispatchType',
              hasMsgId: { $ne: ['$providerMessageId', null] }
            },
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    const summary = { total: 0, sent: 0, failed: 0, sending: 0, manual: 0 };
    for (const group of statusSummary) {
      const g = group._id || {};
      const count = group.count || 0;
      summary.total += count;
      if (g.dispatchType === 'manual_whatsapp' || g.status === 'manual_link') {
        summary.manual += count;
      } else if (g.status === 'sent' && (g.hasMsgId || g.dispatchType === 'whatsapp')) {
        summary.sent += count;
      } else if (g.status === 'failed') {
        summary.failed += count;
      } else if (g.status === 'sending') {
        summary.sending += count;
      }
    }

    res.json({
      summary,
      dispatches: dispatches.map((item) => ({
        id: item._id,
        voterName: item.voterName,
        epic: item.voterEpic,
        phone: item.recipientPhone,
        slipType: item.slipType || 'individual',
        dispatchType: item.dispatchType || (item.status === 'manual_link' ? 'manual_whatsapp' : 'whatsapp'),
        status: item.status,
        providerMessageId: item.providerMessageId || null,
        errorMessage: item.errorMessage || '',
        createdAt: item.createdAt,
      })),
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1
      }
    });
  } catch (err) {
    console.error('Dispatch history query failed:', err.message);
    res.status(500).json({ message: 'Dispatch history could not be loaded.' });
  }
});

// Single dispatch record delete (Admin / Organization Admin only)
router.delete('/dispatches/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'tenant_admin') {
      return res.status(403).json({ message: 'Only administrators can delete dispatch records.' });
    }

    const query = { _id: req.params.id };
    if (req.user.role !== 'admin') {
      query.organizationId = req.user.organizationId || 'org_default';
    }

    const deleted = await SlipDispatch.findOneAndDelete(query);
    if (!deleted) {
      return res.status(404).json({ message: 'Dispatch record not found.' });
    }

    res.json({ success: true, message: 'Dispatch record successfully deleted.' });
  } catch (err) {
    console.error('Delete dispatch record failed:', err.message);
    res.status(500).json({ message: 'Failed to delete dispatch record.' });
  }
});

// Bulk or full delete dispatch records (Admin / Organization Admin only)
router.delete('/dispatches', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'tenant_admin') {
      return res.status(403).json({ message: 'Only administrators can delete dispatch records.' });
    }

    const { ids, all } = req.body || {};
    const query = {};
    const targetOrgId = getEffectiveOrgId(req);
    if (targetOrgId) {
      query.organizationId = targetOrgId;
    }

    if (Array.isArray(ids) && ids.length > 0) {
      query._id = { $in: ids };
    } else if (!all) {
      return res.status(400).json({ message: 'Specify record IDs or set all: true to clear records.' });
    }

    const result = await SlipDispatch.deleteMany(query);
    res.json({
      success: true,
      deletedCount: result.deletedCount,
      message: `${result.deletedCount} dispatch records successfully deleted.`
    });
  } catch (err) {
    console.error('Bulk delete dispatch records failed:', err.message);
    res.status(500).json({ message: 'Failed to delete dispatch records.' });
  }
});

router.get('/export.xlsx', async (req, res) => {
  try {
    const query = addVoterAccess(req);
    
    const dataset = req.query.dataset;
    const datasetModules = {
      voters: ['voters'],
      turnout: ['turnout', 'poll-desk'],
      migrants: ['migrants'],
      community: ['community'],
      dispatches: ['history'],
    };
    const requiredModules = datasetModules[dataset];
    if (!requiredModules) return res.status(400).json({ message: 'Invalid dataset requested.' });
    if (['voters', 'turnout', 'migrants', 'community'].includes(dataset) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'पूरा डेटा एक साथ डाउनलोड करने की अनुमति केवल सुपर एडमिन को है।' });
    }
    if (req.user.role !== 'admin' && !requiredModules.some((module) => req.user.modules?.includes(module))) {
      return res.status(403).json({ message: 'Your account does not have access to this export.' });
    }

    if (dataset === 'dispatches') {
      const dispatchQuery = {};
      const targetOrgId = getEffectiveOrgId(req);
      if (targetOrgId) {
        dispatchQuery.organizationId = targetOrgId;
      }
      if (typeof req.query.search === 'string' && req.query.search.trim()) {
        const search = new RegExp(escapeRegex(req.query.search.trim()), 'i');
        dispatchQuery.$or = [
          { voterName: search },
          { voterEpic: search },
          { recipientPhone: search },
        ];
      }
      if (typeof req.query.status === 'string' && req.query.status) {
        if (req.query.status === 'sent') {
          dispatchQuery.status = 'sent';
          dispatchQuery.dispatchType = { $ne: 'manual_whatsapp' };
        } else if (req.query.status === 'manual_link') {
          dispatchQuery.$or = [
            { dispatchType: 'manual_whatsapp' },
            { status: 'manual_link' }
          ];
        } else if (['failed', 'sending'].includes(req.query.status)) {
          dispatchQuery.status = req.query.status;
        } else {
          return res.status(400).json({ message: 'Choose a valid dispatch status.' });
        }
      }
      const dispatches = await SlipDispatch.find(dispatchQuery).sort({ createdAt: -1 }).limit(5000).lean();
      const workbook = createWorkbook();
      addSheet(workbook, 'Dispatches', dispatches.map((item) => ({
        'समय': item.createdAt,
        'मतदाता': item.voterName,
        'EPIC': item.voterEpic,
        'फोन': item.recipientPhone,
        'पर्ची प्रकार': item.slipType === 'family' ? 'परिवार' : 'व्यक्तिगत',
        'माध्यम': item.dispatchType === 'manual_whatsapp' ? 'मैनुअल लिंक' : 'Meta Cloud API',
        'स्थिति': item.status === 'sent' ? 'स्वीकारा गया' : item.status === 'manual_link' ? 'मैनुअल लिंक' : item.status === 'failed' ? 'विफल' : 'भेजा जा रहा है',
        'Meta ID': item.providerMessageId || '',
        'त्रुटि': item.errorMessage || '',
      })));
      return sendWorkbook(res, workbook, 'Dispatch_History');
    }

    if (dataset === 'migrants') {
      query.isMigrant = true;
    }

    if (dataset === 'turnout') {
      query.voted = false;
    }

    if (dataset === 'community') {
      const searchString = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const terms = searchString.split(',').map((term) => term.trim()).filter(Boolean);
      if (!searchString || searchString.length > 500 || terms.length === 0 || terms.length > 12) {
        return res.status(400).json({ message: 'Enter up to 12 community names to export.' });
      }
      
      const termsRegex = terms.map(t => safeRegex(t)).filter(Boolean);
      const orConditions = [];
      termsRegex.forEach(regex => {
        orConditions.push({ caste: regex }, { nameEn: regex }, { nameHi: regex }, { relativeNameEn: regex }, { relativeNameHi: regex });
      });
      if (orConditions.length) query.$or = orConditions;
    } else {
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      if (search) {
        const regex = safeRegex(search);
        if (regex) query.$or = [{ nameHi: regex }, { nameEn: regex }, { epic: regex }, { relativeNameHi: regex }, { relativeNameEn: regex }];
      }
    }
    
    const ward = typeof req.query.ward === 'string' ? req.query.ward.trim() : '';
    if (ward) {
      const wardRegex = safeRegex(ward);
      if (wardRegex) query.wardNo = wardRegex;
    }

    let voters = await Voter.find(query).sort({ wardNo: 1, partNo: 1, serialNo: 1 }).lean();
    if (dataset === 'community' && req.query.includeFamily !== 'false') {
      const familyIds = [...new Set(voters.map((voter) => voter.familyId).filter(Boolean))];
      if (familyIds.length) {
        const familyQuery = addVoterAccess(req);
        familyQuery.familyId = { $in: familyIds };
        const familyVoters = await Voter.find(familyQuery).lean();
        const voterMap = new Map(familyVoters.map((voter) => [voter._id.toString(), voter]));
        voters.forEach((voter) => voterMap.set(voter._id.toString(), voter));
        voters = [...voterMap.values()].sort((a, b) => {
          if (a.wardNo !== b.wardNo) return (a.wardNo || '').localeCompare(b.wardNo || '');
          if (a.partNo !== b.partNo) return (a.partNo || '').localeCompare(b.partNo || '');
          return (a.serialNo || 0) - (b.serialNo || 0);
        });
      }
    }

    const workbook = createWorkbook();
    addSheet(workbook, 'Export', voters.map((v) => ({
      'EPIC No': v.epic,
      'Ward': v.wardNo,
      'Part': v.partNo,
      'Serial No': v.serialNo,
      'Name (English)': v.nameEn,
      'Name (Hindi)': v.nameHi,
      'Age': v.age,
      'Gender': v.gender,
      'Relation': v.relationType,
      'Relative Name (English)': v.relativeNameEn,
      'Relative Name (Hindi)': v.relativeNameHi,
      'House No': (!v.houseNo || ["'-", "-", "0", "000"].includes(String(v.houseNo).trim())) ? '' : String(v.houseNo).replace(/['"]/g, '').trim(),
      'Mobile': v.mobileNo,
      'Caste': v.caste,
      'Status': v.supportStatus,
      'Voted': v.voted ? 'Yes' : 'No'
    })));
    
    await sendWorkbook(res, workbook, `Export_${dataset}`);
  } catch (err) {
    console.error('Export failed:', err.message);
    if (!res.headersSent) res.status(500).json({ message: 'Export failed' });
  }
});

router.get('/slip-config', async (req, res) => {
  try {
    let orgId = req.user?.organizationId || 'org_default';
    if (req.user?.role === 'admin') {
      const selected = req.headers['x-organization-id'] || req.headers['x-client-id'] || req.query?.organizationId;
      if (selected && selected !== 'all') orgId = selected;
    }

    const cacheKey = `slip_config_${orgId}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const org = await Organization.findById(orgId).lean();
    const configResult = {
      organizationId: orgId,
      organizationName: org?.name || 'Default Organization',
      slipConfig: org?.slipConfig || {
        candidateName: '',
        candidateNameEn: '',
        partyName: '',
        partySymbolName: '',
        partySymbolImage: '',
        candidateImage: '',
        evmNumber: '',
        appealHeadline: '',
        subTitle: 'घोषणा पत्र एवं संकल्प पत्र (Manifesto)',
        appealText: '',
        footerAppeal: '',
        pollingStationFallback: '',
        wardPollingStations: {},
        ghoshnaye: [
          'वार्ड/क्षेत्र में 24 घंटे स्वच्छ पेयजल की समुचित आपूर्ति सुनिश्चित करना।',
          'सभी मुख्य व आंतरिक गलियों में पक्की सीसी सड़क एवं कवर्ड नालियों का निर्माण।',
          'रात्रि सुरक्षा हेतु संपूर्ण वार्ड में आधुनिक एलईडी स्ट्रीट लाइट की स्थापना।',
          'प्राथमिक स्वास्थ्य केंद्र एवं नियमित स्वास्थ्य जांच शिविरों का आयोजन।',
          'स्वच्छता एवं नियमित डोर-टू-डोर कचरा संग्रहण की पारदर्शी व्यवस्था।',
          'युवाओं के शारीरिक व बौद्धिक विकास हेतु आधुनिक खेल मैदान एवं लाइब्रेरी।',
          'वरिष्ठ नागरिकों, दिव्यांगजनों एवं माताओं-बहनों की सामाजिक सुरक्षा व सहायता।',
          'नागरिकों की जनसमस्याओं व शिकायतों का 24 घंटे में त्वरित एवं निष्पक्ष समाधान।'
        ]
      }
    };
    cache.set(cacheKey, configResult, 600);
    res.json(configResult);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load slip config' });
  }
});

router.put('/slip-config', async (req, res) => {
  try {
    let orgId = req.user?.organizationId || 'org_default';
    const selected = req.body?.organizationId || req.headers['x-organization-id'] || req.headers['x-client-id'] || req.query?.organizationId;
    
    // Admins can customize any organization; clients/tenants can customize their own organization
    if (selected && selected !== 'all' && selected !== orgId) {
      if (req.user?.role !== 'admin') {
        return res.status(403).json({ message: 'केवल एडमिन ही अन्य खातों/संगठनों की पर्ची बदल सकते हैं।' });
      }
      orgId = selected;
    } else if (selected && selected === orgId) {
      orgId = selected;
    }

    const incomingConfig = req.body?.slipConfig || req.body;
    const org = await Organization.findByIdAndUpdate(
      orgId,
      {
        $set: {
          slipConfig: incomingConfig,
          ...(incomingConfig?.candidateName ? { candidateName: incomingConfig.candidateName } : {})
        }
      },
      { new: true, upsert: true }
    );
    cache.del(`slip_config_${orgId}`);
    res.json({
      success: true,
      organizationId: orgId,
      organizationName: org?.name || 'Organization',
      slipConfig: org?.slipConfig || {}
    });
  } catch (err) {
    console.error('Failed to update slip config:', err.message);
    res.status(500).json({ message: 'Failed to update slip configuration' });
  }
});

module.exports = { router, formatVoter };
