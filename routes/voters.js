const express = require('express');
const router = express.Router();
const cache = require('../lib/cache');
const { formatVoter } = require('./features');
const { verifyToken, requireModule } = require('../middleware/authMiddleware');
const { addVoterAccess, getEffectiveOrgId } = require('../lib/access');
const { escapeRegex, safeRegex, latinToDevanagariRegex } = require('../lib/regexUtils');
const { normalizeDevanagariDigits } = require('../lib/phoneUtils');
const { Voter, User, Organization, SystemSetting } = require('../models/index');

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

const boundedInteger = (value, fallback, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

const buildWardFilterCondition = (ward) => {
  if (!ward) return null;
  const wardList = Array.isArray(ward)
    ? ward
    : typeof ward === 'string'
      ? ward.split(',').map((w) => w.trim()).filter(Boolean)
      : [];
  if (wardList.length === 0 || wardList.includes('all')) return null;

  const conditions = [];
  for (const rawWard of wardList) {
    const cleanWard = String(rawWard).trim().replace(/^(वार्ड|Ward)\s*/i, '').trim();
    if (!cleanWard) continue;
    const escaped = cleanWard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wardRegex = new RegExp(`^(\\s*(वार्ड|Ward)\\s*)?0*${escaped}\\s*$`, 'i');
    const wardNum = Number.parseInt(cleanWard, 10);
    conditions.push({ wardNo: wardRegex });
    if (!Number.isNaN(wardNum)) {
      conditions.push({ wardNo: wardNum });
    }
  }

  if (conditions.length === 0) return null;
  return { $or: conditions };
};

const applyWardFilter = (query, ward) => {
  const cond = buildWardFilterCondition(ward);
  if (!cond) return;
  if (cond.$or) {
    if (query.$and) {
      query.$and.push(cond);
    } else if (query.$or) {
      query.$and = [{ $or: query.$or }, cond];
      delete query.$or;
    } else {
      query.$or = cond.$or;
    }
  } else {
    query.wardNo = cond.wardNo;
  }
};

const buildPanchayatFilterCondition = (panchayat) => {
  if (typeof panchayat !== 'string' || !panchayat.trim()) return null;
  const cleanP = panchayat.trim().replace(/^(पंचायत|ग्राम पंचायत)\s*/i, '').trim();
  const escaped = cleanP.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { panchayat: new RegExp(`^(\\s*(पंचायत|ग्राम पंचायत)\\s*)?${escaped}\\s*$`, 'i') };
};

const applyPanchayatFilter = (query, panchayat) => {
  const cond = buildPanchayatFilterCondition(panchayat);
  if (!cond) return;
  query.panchayat = cond.panchayat;
};

// Get dynamic caste / community options (User-specific -> Org-specific -> Global -> Default)
router.get('/caste-options', verifyToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    const orgId = req.user?.organizationId || getEffectiveOrgId(req);

    // 1. Check user-level caste options
    if (userId) {
      const userDoc = await User.findById(userId).select('casteOptions').lean();
      if (userDoc && Array.isArray(userDoc.casteOptions) && userDoc.casteOptions.length > 0) {
        return res.json({ casteOptions: userDoc.casteOptions, source: 'user' });
      }
    }

    // 2. Check organization-level caste options
    if (orgId) {
      const orgDoc = await Organization.findById(orgId).select('casteOptions settings').lean();
      if (orgDoc && Array.isArray(orgDoc.casteOptions) && orgDoc.casteOptions.length > 0) {
        return res.json({ casteOptions: orgDoc.casteOptions, source: 'organization' });
      }
      if (orgDoc && orgDoc.settings && Array.isArray(orgDoc.settings.casteOptions) && orgDoc.settings.casteOptions.length > 0) {
        return res.json({ casteOptions: orgDoc.settings.casteOptions, source: 'organization' });
      }
    }

    // 3. Check system global setting
    const globalSetting = await SystemSetting.findById('caste_options').lean();
    if (globalSetting && Array.isArray(globalSetting.value) && globalSetting.value.length > 0) {
      return res.json({ casteOptions: globalSetting.value, source: 'global' });
    }

    // 4. Default list
    return res.json({ casteOptions: DEFAULT_CASTES, source: 'default' });
  } catch (err) {
    console.error('Error fetching caste options:', err);
    return res.json({ casteOptions: DEFAULT_CASTES, source: 'fallback' });
  }
});

// Get ALL voters (for Turnout / Analytics)
router.get('/all', verifyToken, requireModule('voters', 'poll-desk', 'turnout', 'warroom'), async (req, res) => {
  try {
    const { ward } = req.query;
    const query = addVoterAccess(req);
    const orgId = query.organizationId || req.user.organizationId || 'org_default';
    const cacheKey = `voters_all_${orgId}_${req.user.id}_${ward || 'all'}`;
    
    // Check Cache
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      return res.json(cachedData);
    }
    
    applyWardFilter(query, ward);
    
    const voters = await Voter.find(query)
      .sort({ wardNo: 1, partNo: 1, serialNo: 1 })
      .collation({ locale: 'en', numericOrdering: true })
      .lean();
    
    // Set Cache
    cache.set(cacheKey, voters);
    
    res.json(voters);
  } catch (err) {
    console.error('Voter analytics query failed:', err.message);
    res.status(500).json({ message: 'Voter analytics could not be loaded.' });
  }
});

// High-performance Turnout Summary using MongoDB Aggregation Pipeline + Cache
router.get('/turnout-summary', verifyToken, requireModule('voters', 'poll-desk', 'turnout', 'warroom'), async (req, res) => {
  try {
    const query = addVoterAccess(req);
    const orgId = query.organizationId || req.user.organizationId || 'org_default';
    const cacheKey = `turnout_summary_${orgId}_${req.user.id}`;
    
    // Check Cache (instant response < 3ms)
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      return res.json(cachedData);
    }

    const [aggregationResult] = await Voter.aggregate([
      { $match: query },
      {
        $facet: {
          overall: [
            {
              $group: {
                _id: null,
                totalVoters: { $sum: 1 },
                totalVoted: { $sum: { $cond: [{ $eq: ['$voted', true] }, 1, 0] } },
                maleVoted: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ['$voted', true] },
                          { $in: ['$gender', ['पुरुष', 'Male', 'M']] }
                        ]
                      },
                      1,
                      0
                    ]
                  }
                },
                femaleVoted: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ['$voted', true] },
                          { $in: ['$gender', ['स्त्री', 'महिला', 'Female', 'F']] }
                        ]
                      },
                      1,
                      0
                    ]
                  }
                }
              }
            }
          ],
          byWard: [
            {
              $group: {
                _id: '$wardNo',
                total: { $sum: 1 },
                voted: { $sum: { $cond: [{ $eq: ['$voted', true] }, 1, 0] } }
              }
            }
          ]
        }
      }
    ]);

    const overall = aggregationResult?.overall?.[0] || {
      totalVoters: 0,
      totalVoted: 0,
      maleVoted: 0,
      femaleVoted: 0
    };

    const wardSummaries = (aggregationResult?.byWard || [])
      .filter((w) => w._id !== null && w._id !== undefined && String(w._id).trim() !== '')
      .map((w) => ({
        name: String(w._id),
        total: w.total || 0,
        voted: w.voted || 0
      }))
      .sort((a, b) => {
        const numA = parseInt(a.name, 10);
        const numB = parseInt(b.name, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return String(a.name).localeCompare(String(b.name));
      });

    const totalVoters = overall.totalVoters || 0;
    const totalVoted = overall.totalVoted || 0;
    const remaining = Math.max(0, totalVoters - totalVoted);
    const turnout = totalVoters > 0 ? Math.round((totalVoted / totalVoters) * 100) : 0;

    const result = {
      totalVoters,
      totalVoted,
      remaining,
      turnout,
      maleVoted: overall.maleVoted || 0,
      femaleVoted: overall.femaleVoted || 0,
      wardSummaries,
      updatedAt: new Date().toISOString()
    };

    // Cache for 60 seconds
    cache.set(cacheKey, result, 60);

    res.json(result);
  } catch (err) {
    console.error('Turnout summary query failed:', err.message);
    res.status(500).json({ message: 'Turnout summary could not be loaded.' });
  }
});

// High-performance Paginated Pending Voters for Turnout Desk
router.get('/turnout-pending', verifyToken, requireModule('voters', 'poll-desk', 'turnout', 'warroom'), async (req, res) => {
  try {
    const { ward } = req.query;
    const page = boundedInteger(req.query.page, 1, 100000);
    const limit = boundedInteger(req.query.limit, 50, 100);
    const skip = (page - 1) * limit;

    const query = addVoterAccess(req);
    query.voted = false;

    applyWardFilter(query, ward);

    const projection = {
      _id: 1,
      sqlId: 1,
      epic: 1,
      nameEn: 1,
      nameHi: 1,
      wardNo: 1,
      partNo: 1,
      serialNo: 1,
      gender: 1,
      mobileNo: 1,
      supportStatus: 1,
      voted: 1
    };

    const [total, rawVoters] = await Promise.all([
      Voter.countDocuments(query),
      Voter.find(query, projection)
        .sort({ wardNo: 1, partNo: 1, serialNo: 1 })
        .collation({ locale: 'en', numericOrdering: true })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    const voters = rawVoters.map(formatVoter);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.json({
      voters,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages
      }
    });
  } catch (err) {
    console.error('Turnout pending voters query failed:', err.message);
    res.status(500).json({ message: 'Turnout pending voters could not be loaded.' });
  }
});

// Get unique wards list with counts for current organization (Cached 5m)
router.get('/wards-summary', verifyToken, requireModule('voters', 'community', 'poll-desk'), async (req, res) => {
  try {
    const query = addVoterAccess(req);
    const orgId = query.organizationId || req.user.organizationId || 'org_default';
    const cacheKey = `wards_summary_${orgId}_${req.user.id}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    const [rawWards, total, familyFacet] = await Promise.all([
      Voter.aggregate([
        { $match: query },
        { $group: { _id: '$wardNo', count: { $sum: 1 } } }
      ]),
      Voter.countDocuments(query),
      Voter.aggregate([
        {
          $match: {
            ...query,
            houseNo: {
              $exists: true,
              $nin: [null, '', '-', '—', "'—", "'0", '0', '00', '000', 'NA', 'na', 'N/A', 'n/a', 'null', 'undefined', 'लागू नहीं', 'उपलब्ध नहीं']
            }
          }
        },
        {
          $group: {
            _id: {
              houseNo: '$houseNo',
              wardNo: { $ifNull: ['$wardNo', ''] },
              panchayat: { $ifNull: ['$panchayat', ''] },
              partNo: { $ifNull: ['$partNo', ''] }
            }
          }
        },
        { $count: 'totalFamilies' }
      ])
    ]);
    const wards = rawWards
      .filter((w) => w._id !== null && w._id !== undefined && String(w._id).trim() !== '')
      .sort((a, b) => {
        const numA = parseInt(a._id, 10);
        const numB = parseInt(b._id, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return String(a._id).localeCompare(String(b._id));
      });
    const totalFamilies = familyFacet?.[0]?.totalFamilies || 0;
    const result = { wards, total, totalFamilies };
    cache.set(cacheKey, result, 300);
    res.json(result);
  } catch (err) {
    console.error('Wards summary failed:', err.message);
    res.status(500).json({ message: 'Wards could not be loaded.' });
  }
});

// Get unique panchayats list with counts for current organization (Cached 5m)
router.get('/panchayats-summary', verifyToken, requireModule('voters', 'community', 'poll-desk'), async (req, res) => {
  try {
    const query = addVoterAccess(req);
    const orgId = query.organizationId || req.user.organizationId || 'org_default';
    const cacheKey = `panchayats_summary_${orgId}_${req.user.id}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    const rawPanchayats = await Voter.aggregate([
      { $match: { ...query, panchayat: { $exists: true, $ne: '' } } },
      { $group: { _id: '$panchayat', count: { $sum: 1 } } }
    ]);
    const panchayats = rawPanchayats
      .filter((p) => p._id !== null && p._id !== undefined && String(p._id).trim() !== '')
      .sort((a, b) => String(a._id).localeCompare(String(b._id)));
    const total = await Voter.countDocuments(query);
    const result = { panchayats, total };
    cache.set(cacheKey, result, 300);
    res.json(result);
  } catch (err) {
    console.error('Panchayats summary failed:', err.message);
    res.status(500).json({ message: 'Panchayats could not be loaded.' });
  }
});

// High-performance Paginated Households for Family Voter Slips (Cached 60s)
router.get('/households', verifyToken, requireModule('voters', 'community'), async (req, res) => {
  try {
    const page = boundedInteger(req.query.page, 1, 10000);
    const limit = boundedInteger(req.query.limit, 30, 100);
    const skip = (page - 1) * limit;
    const { ward, panchayat, part, search } = req.query;

    const query = addVoterAccess(req);
    applyWardFilter(query, ward);
    applyPanchayatFilter(query, panchayat);
    if (typeof part === 'string' && part.trim()) {
      const cleanPart = part.trim().replace(/^(भाग|Part)\s*/i, '');
      const partRegex = safeRegex(`^${cleanPart}$`);
      if (partRegex) query.partNo = partRegex;
    }
    if (typeof search === 'string' && search.trim()) {
      const searchRegex = safeRegex(search);
      const latinDevRegex = latinToDevanagariRegex(search);
      if (searchRegex) {
        query.$or = [
          { houseNo: searchRegex },
          { nameHi: searchRegex },
          { nameEn: searchRegex },
          { epic: searchRegex }
        ];
        if (latinDevRegex) {
          query.$or.push({ nameHi: latinDevRegex });
        }
      }
    }

    // Exclude invalid/placeholder house numbers from household groupings
    const invalidHouseList = [null, '', '-', '—', "'—", "'0", '0', '00', '000', 'NA', 'na', 'N/A', 'n/a', 'null', 'undefined', 'लागू नहीं', 'उपलब्ध नहीं'];
    if (!query.$and) query.$and = [];
    query.$and.push(
      { houseNo: { $exists: true, $nin: invalidHouseList } },
      { houseNo: { $not: /^[\s\-_0—'"]*$/ } }
    );

    const orgId = query.organizationId || req.user.organizationId || 'org_default';
    const cacheKey = `households_${orgId}_${req.user.id}_w${ward || ''}_pn${panchayat || ''}_p${part || ''}_s${search || ''}_p${page}_l${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const [facetResult] = await Voter.aggregate([
      { $match: query },
      {
        $group: {
          _id: {
            houseNo: '$houseNo',
            wardNo: { $ifNull: ['$wardNo', ''] },
            panchayat: { $ifNull: ['$panchayat', ''] },
            partNo: { $ifNull: ['$partNo', ''] }
          },
          memberCount: { $sum: 1 },
          headName: { $first: { $ifNull: ['$nameHi', '$nameEn'] } },
          members: {
            $push: {
              _id: '$_id',
              serialNo: '$serialNo',
              nameHi: '$nameHi',
              nameEn: '$nameEn',
              relativeNameHi: '$relativeNameHi',
              relativeNameEn: '$relativeNameEn',
              relationType: '$relationType',
              age: '$age',
              gender: '$gender',
              epic: '$epic',
              houseNo: '$houseNo',
              wardNo: '$wardNo',
              panchayat: '$panchayat',
              partNo: '$partNo',
              familyHead: '$familyHead',
              phone: { $ifNull: ['$mobileNo', '$phone'] },
              mobileNo: { $ifNull: ['$mobileNo', '$phone'] },
              boothName: '$boothName',
              caste: { $ifNull: ['$caste', ''] },
              surety: { $ifNull: ['$surety', ''] },
              supportStatus: { $ifNull: ['$supportStatus', 'unmarked'] },
              isMigrant: { $ifNull: ['$isMigrant', false] },
              migrantLocation: { $ifNull: ['$migrantLocation', ''] },
              photoUrl: { $ifNull: ['$photoUrl', ''] }
            }
          }
        }
      },
      { $sort: { memberCount: -1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }]
        }
      }
    ]);

    const totalHouseholds = facetResult?.metadata?.[0]?.total || 0;
    const rawList = facetResult?.data || [];
    const households = rawList.map((item) => {
      const houseNo = item._id.houseNo;
      const wardNo = item._id.wardNo;
      const partNo = item._id.partNo;
      const members = (item.members || []).sort((a, b) => (Number(a.serialNo) || 0) - (Number(b.serialNo) || 0));
      const headVoter = members.find((m) => m.familyHead && (m.familyHead === m.nameHi || m.familyHead === m.nameEn))
        || [...members].sort((a, b) => (Number(b.age) || 0) - (Number(a.age) || 0))[0]
        || members[0];
      const caste = members.find((m) => m.caste)?.caste || '';
      return {
        key: `${wardNo}_${partNo}_${houseNo}`,
        houseNo,
        wardNo,
        panchayat: item._id.panchayat || '',
        partNo,
        members,
        memberCount: item.memberCount,
        headName: headVoter?.nameHi || headVoter?.nameEn || item.headName || 'मुखिया',
        caste
      };
    });

    const totalPages = Math.max(1, Math.ceil(totalHouseholds / limit));
    const result = {
      households,
      pagination: {
        page,
        limit,
        total: totalHouseholds,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages
      }
    };

    cache.set(cacheKey, result, 60);
    res.json(result);
  } catch (err) {
    console.error('Households query failed:', err.message);
    res.status(500).json({ message: 'Households could not be loaded.' });
  }
});

// Get all voters (with search & pagination)
router.get('/', verifyToken, requireModule('voters', 'community', 'workers', 'migrants'), async (req, res) => {
  try {
    const { search, relative, ward, panchayat, part, house, isMigrant, supportStatus, caste, assignedWorker, status, gender } = req.query;
    const query = addVoterAccess(req);

    if (typeof search === 'string' && search.trim()) {
      const trimmed = search.trim().slice(0, 100);
      const searchRegex = safeRegex(trimmed);
      const latinDevRegex = latinToDevanagariRegex(trimmed);
      const isExplicitVoterId = /^voter/i.test(trimmed);
      const isAsciiWord = /^[a-z]+$/i.test(trimmed);

      const orConditions = [];

      // 1. Direct regex match on name fields
      if (searchRegex) {
        orConditions.push({ nameHi: searchRegex });
        orConditions.push({ nameEn: searchRegex });
      }

      // If input is English/Latin, match via phonetic Devanagari regex
      if (latinDevRegex) {
        if (trimmed.length <= 3 && isAsciiWord) {
          // For short queries like "p", "bu", "ma", match start of name or start of any word in name
          const prefixPattern = new RegExp('(^|\\s)(' + latinDevRegex.source + ')', 'i');
          orConditions.push({ nameHi: prefixPattern });
          orConditions.push({ nameEn: prefixPattern });
        } else {
          orConditions.push({ nameHi: latinDevRegex });
          orConditions.push({ nameEn: latinDevRegex });
        }
      }

      // 2. EPIC match: do NOT match internal fallback placeholder IDs (e.g. VOTER_W1_P5091_...)
      if (isExplicitVoterId) {
        orConditions.push({ epic: searchRegex });
      } else if (trimmed.length < 3) {
        // For 1-2 char queries, only match if a real EPIC number actually starts with it (e.g. "SSB", "RJ")
        orConditions.push({
          $and: [
            { epic: new RegExp('^' + escapeRegex(trimmed), 'i') },
            { epic: { $not: /^VOTER_/i } }
          ]
        });
      } else {
        // For 3+ char queries, match real EPIC containing it, but NEVER match fallback ^VOTER_ IDs
        orConditions.push({
          $and: [
            { epic: searchRegex },
            { epic: { $not: /^VOTER_/i } }
          ]
        });
      }

      // 3. Serial number match (exact integer)
      const parsedSerial = Number.parseInt(trimmed, 10);
      if (!Number.isNaN(parsedSerial) && String(parsedSerial) === trimmed) {
        orConditions.push({ serialNo: parsedSerial });
      }

      // 4. Mobile number match (only if 3-10 digits)
      if (/^\d{3,10}$/.test(trimmed) && searchRegex) {
        orConditions.push({ mobileNo: searchRegex });
      }

      query.$or = orConditions;
    }
    
    if (typeof relative === 'string' && relative.trim()) {
      const relTrimmed = relative.trim().slice(0, 100);
      const relativeRegex = safeRegex(relTrimmed);
      const relLatinDevRegex = latinToDevanagariRegex(relTrimmed);
      if (relativeRegex) {
        const relConditions = [{ relativeNameHi: relativeRegex }, { relativeNameEn: relativeRegex }];
        if (relLatinDevRegex) {
          relConditions.push({ relativeNameHi: relLatinDevRegex });
        }
        if (query.$or) {
          query.$and = [{ $or: query.$or }, { $or: relConditions }];
          delete query.$or;
        } else {
          query.$or = relConditions;
        }
      }
    }
    
    applyWardFilter(query, ward);
    applyPanchayatFilter(query, panchayat);
    if (typeof part === 'string' && part.trim()) {
      const cleanPart = part.trim().replace(/^(भाग|Part)\s*/i, '');
      const partRegex = safeRegex(cleanPart);
      if (partRegex) query.partNo = partRegex;
    }
    if (typeof house === 'string' && house.trim()) {
      const houseRegex = safeRegex(house);
      if (houseRegex) query.houseNo = houseRegex;
    }
    if (isMigrant === 'true' || isMigrant === 'false') query.isMigrant = isMigrant === 'true';
    if (typeof supportStatus === 'string' && ['core', 'swing', 'opposition', 'unmarked'].includes(supportStatus)) {
      query.supportStatus = supportStatus;
    }
    if (typeof caste === 'string' && caste.trim()) {
      const casteRegex = safeRegex(caste);
      if (casteRegex) query.caste = casteRegex;
    }
    if (typeof assignedWorker === 'string' && assignedWorker.trim()) {
      const workerRegex = safeRegex(assignedWorker);
      if (workerRegex) query.assignedWorker = workerRegex;
    }
    if (typeof status === 'string' && status.trim()) {
      query.status = status.trim();
    }
    if (typeof gender === 'string' && gender.trim()) {
      const g = gender.trim();
      if (['पुरुष', 'Male', 'M', 'male'].includes(g)) {
        query.gender = { $in: ['पुरुष', 'पुरूष', 'Male', 'M', 'male'] };
      } else if (['स्त्री', 'महिला', 'Female', 'F', 'female'].includes(g)) {
        query.gender = { $in: ['स्त्री', 'महिला', 'Female', 'F', 'female'] };
      } else {
        const genderRegex = safeRegex(g);
        if (genderRegex) query.gender = genderRegex;
      }
    }

    const isAll = req.query.all === 'true' || req.query.all === '1';
    const page = boundedInteger(req.query.page, 1, 100000);
    const pageSize = boundedInteger(req.query.pageSize, 100, 10000);
    
    // Execute count and paginated query in parallel for 2x faster responses
    const voterQuery = Voter.find(query)
      .sort({ wardNo: 1, partNo: 1, serialNo: 1 })
      .collation({ locale: 'en', numericOrdering: true })
      .lean();
    if (!isAll) {
      voterQuery.skip((page - 1) * pageSize).limit(pageSize);
    } else {
      voterQuery.limit(10000);
    }

    const [count, voters] = await Promise.all([
      Voter.countDocuments(query),
      voterQuery,
    ]);

    const formattedVoters = voters.map((v) => ({
      ...v,
      houseNo: v.houseNo ? String(v.houseNo).replace(/^0+(\d+)/, '$1') : '',
      phone: v.mobileNo || v.phone || '',
      mobileNo: v.mobileNo || v.phone || '',
    }));
      
    res.json(req.query.page || req.query.pageSize || isAll
      ? { data: formattedVoters, page: isAll ? 1 : page, pageSize: isAll ? count : pageSize, total: count }
      : formattedVoters);
  } catch (err) {
    console.error('Voter search failed:', err.message);
    res.status(500).json({ message: 'Voter records could not be loaded.' });
  }
});

// Get family members by houseNo
router.get('/family/:houseNo', verifyToken, requireModule('voters', 'community'), async (req, res) => {
  try {
    const rawHouse = (req.params.houseNo || '').trim();
    const cleanHouse = rawHouse.replace(/^#/, '').trim();
    const invalidHouses = ['', '-', '—', "'—", "'0", '0', '00', '000', 'na', 'n/a', 'null', 'undefined', 'लागू नहीं', 'उपलब्ध नहीं'];
    if (!cleanHouse || invalidHouses.includes(cleanHouse.toLowerCase())) {
      return res.json([]);
    }

    const houseNum = Number.parseInt(cleanHouse, 10);

    const houseConditions = [
      { houseNo: rawHouse },
      { houseNo: cleanHouse },
      { houseNo: `#${cleanHouse}` },
      { familyId: rawHouse },
      { familyId: cleanHouse }
    ];
    if (!Number.isNaN(houseNum)) {
      houseConditions.push({ houseNo: houseNum });
    }

    const andConditions = [{ $or: houseConditions }];

    const query = addVoterAccess(req);

    // STRICT WARD ISOLATION
    let requestedWard = req.query.ward || req.query.wardNo;

    // If ward was not passed in URL, but voterId or epic was, anchor strictly to that voter's ward
    if (!requestedWard && (req.query.voterId || req.query.epic)) {
      const anchorVoter = await Voter.findOne({
        organizationId: query.organizationId || req.user.organizationId,
        ...(req.query.voterId ? { _id: req.query.voterId } : { epic: req.query.epic })
      }).select('wardNo partNo').lean();
      if (anchorVoter && anchorVoter.wardNo) {
        requestedWard = anchorVoter.wardNo;
        if (!req.query.part && anchorVoter.partNo) {
          req.query.part = anchorVoter.partNo;
        }
      }
    }

    if (typeof requestedWard === 'string' && requestedWard.trim()) {
      applyWardFilter(query, requestedWard.trim());
    }

    const requestedPart = req.query.part || req.query.partNo;
    if (typeof requestedPart === 'string' && requestedPart.trim()) {
      const rawPart = requestedPart.trim();
      const cleanPart = rawPart.replace(/^(भाग|Part)\s*/i, '').trim();
      const partNum = Number.parseInt(cleanPart, 10);
      const partConditions = [
        { partNo: rawPart },
        { partNo: cleanPart },
        { partNo: `Part ${cleanPart}` },
        { partNo: `भाग ${cleanPart}` }
      ];
      if (!Number.isNaN(partNum)) {
        partConditions.push({ partNo: partNum });
      }
      andConditions.push({ $or: partConditions });
    }

    if (query.$and && Array.isArray(query.$and)) {
      query.$and.push(...andConditions);
    } else {
      query.$and = andConditions;
    }

    const voters = await Voter.find(query).sort({ serialNo: 1 }).lean();
    const formattedVoters = voters.map((v) => ({
      ...v,
      phone: v.mobileNo || v.phone || '',
      mobileNo: v.mobileNo || v.phone || '',
    }));
    res.json(formattedVoters);
  } catch (err) {
    console.error('Household voter query failed:', err.message);
    res.status(500).json({ message: 'Household records could not be loaded.' });
  }
});

// Update Voter Info
router.put('/:id', verifyToken, (req, res, next) => {
  const keys = Object.keys(req.body || {});
  const migrantOnly = keys.length > 0 && keys.every((key) => ['isMigrant', 'migrantLocation'].includes(key));
  return requireModule(migrantOnly ? 'migrants' : 'voters')(req, res, next);
}, async (req, res) => {
  try {
    const id = req.params.id; // MongoDB _id is string/ObjectId, but frontend might send number if it thinks it's SQL
    
    const columns = {
      phone: 'mobileNo',
      mobileNo: 'mobileNo',
      caste: 'caste',
      surety: 'surety',
      isMigrant: 'isMigrant',
      assignedWorker: 'assignedWorker',
      supportStatus: 'supportStatus',
      notes: 'notes',
      familyId: 'familyId',
      migrantLocation: 'migrantLocation',
      nameEn: 'nameEn',
      nameHi: 'nameHi',
      relativeNameEn: 'relativeNameEn',
      relativeNameHi: 'relativeNameHi',
      relationType: 'relationType',
      age: 'age',
      gender: 'gender',
      epic: 'epic',
      houseNo: 'houseNo',
      wardNo: 'wardNo',
      partNo: 'partNo',
      serialNo: 'serialNo',
      boothName: 'boothName',
      villageName: 'villageName',
      villageNameHi: 'villageNameHi',
      occupation: 'occupation',
      panchayat: 'panchayat',
      panchayatHi: 'panchayatHi',
      voted: 'voted',
      photoUrl: 'photoUrl',
    };
    
    const updates = {};
    for (const [key, dbColumn] of Object.entries(columns)) {
      if (Object.hasOwn(req.body, key)) {
        const val = req.body[key];
        if (key === 'age') {
          const numAge = Number.parseInt(normalizeDevanagariDigits(val), 10);
          updates[dbColumn] = !isNaN(numAge) && numAge >= 18 && numAge <= 125 ? numAge : null;
        } else if (key === 'serialNo') {
          const numSerial = Number.parseInt(normalizeDevanagariDigits(val), 10);
          updates[dbColumn] = !isNaN(numSerial) && numSerial > 0 ? numSerial : null;
        } else if (key === 'phone' || key === 'mobileNo') {
          const cleanPh = normalizeDevanagariDigits(String(val || '')).replace(/\D/g, '').slice(-10);
          updates[dbColumn] = cleanPh;
        } else if (key === 'voted' || key === 'isMigrant') {
          updates[dbColumn] = Boolean(val);
        } else if (key === 'nameHi' && typeof val === 'string') {
          updates[dbColumn] = val.replace(/[a-zA-Z\d\u0966-\u096F]/g, '').replace(/[^\u0900-\u097F\s]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
        } else if (key === 'relativeNameHi' && typeof val === 'string') {
          updates[dbColumn] = val.replace(/[a-zA-Z\d\u0966-\u096F]/g, '').replace(/[^\u0900-\u097F\s]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
        } else if (typeof val === 'string') {
          updates[dbColumn] = val.trim().slice(0, 500);
        } else if (typeof val === 'number') {
          updates[dbColumn] = val;
        }
      }
    }
    
    if (Object.keys(updates).length === 0) return res.status(400).json({ message: 'No supported voter fields were provided.' });
    if (Object.hasOwn(req.body, 'isMigrant') && typeof req.body.isMigrant !== 'boolean') {
      return res.status(400).json({ message: 'Voter fields contain invalid values.' });
    }
    if (Object.hasOwn(req.body, 'supportStatus') && !['core', 'swing', 'opposition', 'unmarked'].includes(req.body.supportStatus)) {
      return res.status(400).json({ message: 'Choose a valid support status.' });
    }

    const query = addVoterAccess(req);
    // Handle both SQL ID (number) and MongoDB ID (string) gracefully during migration
    if (!isNaN(id)) {
      query.sqlId = Number.parseInt(id, 10);
    } else {
      query._id = id;
    }
    
    const voter = await Voter.findOneAndUpdate(query, { $set: updates }, { returnDocument: 'after' }).lean();
    
    if (!voter) return res.status(404).json({ message: 'Voter not found or access denied.' });

    // Invalidate Cache for this organization
    const orgKey = query.organizationId || req.user.organizationId || 'org_default';
    cache.delPrefix(`voters_all_${orgKey}_`);
    cache.delPrefix(`wards_summary_${orgKey}_`);
    cache.delPrefix(`turnout_summary_${orgKey}_`);

    res.json(voter);
  } catch (err) {
    console.error('Voter update failed:', err.message);
    res.status(500).json({ message: 'Voter details could not be updated.' });
  }
});

// Toggle Vote Status
router.put('/:id/vote', verifyToken, requireModule('poll-desk', 'turnout'), async (req, res) => {
  try {
    const id = req.params.id;
    const { voted } = req.body;
    
    if (typeof voted !== 'boolean') {
      return res.status(400).json({ message: 'A valid voter ID and boolean vote status are required.' });
    }
    
    const query = addVoterAccess(req);
    if (!isNaN(id)) {
      query.sqlId = Number.parseInt(id, 10);
    } else {
      query._id = id;
    }
    
    const voter = await Voter.findOneAndUpdate(
      query,
      { $set: { voted, votedAt: voted ? new Date() : null } },
      { returnDocument: 'after' }
    );
    
    if (!voter) return res.status(404).json({ message: 'Voter not found or access denied.' });
    
    // Invalidate Cache for this organization
    const orgKey = query.organizationId || req.user.organizationId || 'org_default';
    cache.delPrefix(`voters_all_${orgKey}_`);
    cache.delPrefix(`turnout_summary_${orgKey}_`);
    
    res.json({ success: true, message: 'Vote status updated.' });
  } catch (err) {
    console.error('Vote status update failed:', err.message);
    res.status(500).json({ message: 'Vote status could not be updated.' });
  }
});
// DELETE single voter (Admin Only)
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        message: 'क्लाइंट्स को डेटा डिलीट करने की अनुमति नहीं है। यह अधिकार केवल सुपर एडमिन के पास है।'
      });
    }

    const { id } = req.params;
    const query = addVoterAccess(req);
    if (!isNaN(id)) {
      query.sqlId = Number.parseInt(id, 10);
    } else {
      query._id = id;
    }

    const deleted = await Voter.findOneAndDelete(query);
    if (!deleted) {
      return res.status(404).json({ message: 'मतदाता नहीं मिला या पहले ही डिलीट हो चुका है।' });
    }

    // Invalidate Cache for this organization
    const orgKey = query.organizationId || req.user.organizationId || 'org_default';
    cache.delPrefix(`voters_all_${orgKey}_`);
    cache.delPrefix(`wards_summary_${orgKey}_`);
    cache.delPrefix(`turnout_summary_${orgKey}_`);

    res.json({ success: true, message: 'मतदाता सफलतापूर्वक डिलीट कर दिया गया।' });
  } catch (err) {
    console.error('Voter deletion failed:', err.message);
    res.status(500).json({ message: 'डेटा डिलीट करने में त्रुटि आई।' });
  }
});

// BULK UPDATE voters (Tagging, Caste, Support, Migrant, Phone, Notes)
router.post('/bulk-update', verifyToken, requireModule('voters', 'community'), async (req, res) => {
  try {
    const { ids, updates, houseNo, wardNo } = req.body;
    if ((!Array.isArray(ids) || ids.length === 0) && !houseNo) {
      return res.status(400).json({ message: 'अपडेट के लिए मतदाता IDs या परिवार मकान नंबर आवश्यक है।' });
    }

    const safeUpdates = {};
    if (Object.hasOwn(updates || {}, 'caste')) safeUpdates.caste = String(updates.caste || '').trim();
    if (Object.hasOwn(updates || {}, 'supportStatus')) {
      const st = updates.supportStatus;
      if (['core', 'swing', 'opposition', 'unmarked'].includes(st)) {
        safeUpdates.supportStatus = st;
        if (st === 'core') safeUpdates.surety = '100% पक्का';
        else if (st === 'swing') safeUpdates.surety = '50-50';
        else if (st === 'opposition') safeUpdates.surety = 'विरोधी';
        else if (st === 'unmarked') safeUpdates.surety = 'सामान्य';
      }
    }
    if (Object.hasOwn(updates || {}, 'surety')) {
      safeUpdates.surety = String(updates.surety || '').trim();
      if (safeUpdates.surety === '100% पक्का') safeUpdates.supportStatus = 'core';
      else if (safeUpdates.surety === '50-50') safeUpdates.supportStatus = 'swing';
      else if (safeUpdates.surety === 'विरोधी') safeUpdates.supportStatus = 'opposition';
      else if (safeUpdates.surety === 'सामान्य') safeUpdates.supportStatus = 'unmarked';
    }
    if (Object.hasOwn(updates || {}, 'isMigrant')) {
      safeUpdates.isMigrant = Boolean(updates.isMigrant);
      if (updates.migrantLocation) safeUpdates.migrantLocation = String(updates.migrantLocation).trim();
    }
    if (Object.hasOwn(updates || {}, 'mobileNo') || Object.hasOwn(updates || {}, 'phone')) {
      const rawPh = String(updates.mobileNo || updates.phone || '').trim();
      const ph = normalizeDevanagariDigits(rawPh).replace(/\D/g, '').slice(-10);
      safeUpdates.mobileNo = ph;
    }
    if (Object.hasOwn(updates || {}, 'notes')) {
      safeUpdates.notes = String(updates.notes || '').trim();
    }

    if (Object.keys(safeUpdates).length === 0) {
      return res.status(400).json({ message: 'कोई वैध अपडेट फ़ील्ड नहीं दी गई।' });
    }

    const query = addVoterAccess(req);
    if (Array.isArray(ids) && ids.length > 0) {
      query._id = { $in: ids };
    } else if (houseNo) {
      const cleanH = String(houseNo).replace(/^#/, '').trim();
      query.houseNo = { $in: [houseNo, cleanH, `#${cleanH}`] };
      if (wardNo) applyWardFilter(query, wardNo);
    }

    const result = await Voter.updateMany(query, { $set: safeUpdates });

    // Invalidate Cache for this organization
    const orgKey = query.organizationId || req.user.organizationId || 'org_default';
    cache.delPrefix(`voters_all_${orgKey}_`);
    cache.delPrefix(`wards_summary_${orgKey}_`);
    cache.delPrefix(`turnout_summary_${orgKey}_`);
    cache.delPrefix(`households_${orgKey}_`);
    cache.delPrefix(`caste_`);
    cache.delPrefix(`community_`);

    res.json({
      success: true,
      message: `${result.modifiedCount} मतदाता सफलतापूर्वक अपडेट किए गए।`,
      modifiedCount: result.modifiedCount
    });
  } catch (err) {
    console.error('Bulk voter update failed:', err.message);
    res.status(500).json({ message: 'मतदाता अपडेट करने में त्रुटि आई।' });
  }
});

// Set Family Phone (assigns same mobile number to entire household)
router.post('/family-phone', verifyToken, requireModule('voters', 'community'), async (req, res) => {
  try {
    const { houseNo, wardNo, phone } = req.body;
    if (!houseNo) {
      return res.status(400).json({ message: 'मकान संख्या आवश्यक है।' });
    }
    const cleanPhone = normalizeDevanagariDigits(String(phone || '')).trim().replace(/\D/g, '').slice(-10);
    const query = addVoterAccess(req);
    const cleanH = String(houseNo).replace(/^#/, '').trim();
    query.houseNo = { $in: [houseNo, cleanH, `#${cleanH}`] };
    if (wardNo) applyWardFilter(query, wardNo);

    const result = await Voter.updateMany(query, { $set: { mobileNo: cleanPhone } });

    const orgKey = query.organizationId || req.user.organizationId || 'org_default';
    cache.delPrefix(`voters_all_${orgKey}_`);
    cache.delPrefix(`households_${orgKey}_`);

    res.json({
      success: true,
      message: `परिवार के सभी ${result.modifiedCount} सदस्यों के लिए मोबाइल नंबर सुरक्षित किया गया।`,
      modifiedCount: result.modifiedCount,
      phone: cleanPhone
    });
  } catch (err) {
    console.error('Family phone update failed:', err.message);
    res.status(500).json({ message: 'परिवार मोबाइल नंबर सहेजने में त्रुटि आई।' });
  }
});

// Set Family Caste (assigns caste tag to entire household)
router.post('/family-caste', verifyToken, requireModule('voters', 'community'), async (req, res) => {
  try {
    const { houseNo, wardNo, caste } = req.body;
    if (!houseNo) {
      return res.status(400).json({ message: 'मकान संख्या आवश्यक है।' });
    }
    const cleanCaste = String(caste || '').trim();
    if (!cleanCaste) {
      return res.status(400).json({ message: 'जाति का नाम आवश्यक है।' });
    }
    const query = addVoterAccess(req);
    const cleanH = String(houseNo).replace(/^#/, '').trim();
    query.houseNo = { $in: [houseNo, cleanH, `#${cleanH}`] };
    if (wardNo) applyWardFilter(query, wardNo);

    const result = await Voter.updateMany(query, { $set: { caste: cleanCaste } });

    const orgKey = query.organizationId || req.user.organizationId || 'org_default';
    cache.delPrefix(`voters_all_${orgKey}_`);
    cache.delPrefix(`households_${orgKey}_`);
    cache.delPrefix(`caste_${orgKey}_`);
    cache.delPrefix(`community_${orgKey}_`);

    res.json({
      success: true,
      message: `परिवार के सभी ${result.modifiedCount} सदस्यों के लिए जाति '${cleanCaste}' सफलतापूर्वक अपडेट की गई।`,
      modifiedCount: result.modifiedCount,
      caste: cleanCaste
    });
  } catch (err) {
    console.error('Family caste update failed:', err.message);
    res.status(500).json({ message: 'परिवार की जाति अपडेट करने में त्रुटि आई।' });
  }
});

// BULK DELETE voters (Admin Only)
router.post('/bulk-delete', verifyToken, async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        message: 'क्लाइंट्स को डेटा डिलीट करने की अनुमति नहीं है। यह अधिकार केवल सुपर एडमिन के पास है।'
      });
    }

    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'डिलीट करने के लिए मतदाता IDs आवश्यक हैं।' });
    }

    const query = addVoterAccess(req);
    query._id = { $in: ids };

    // Clean Cloudinary images for deleted voters
    try {
      const { deleteVoterPhotos } = require('../lib/cloudinaryService');
      const votersWithPhotos = await Voter.find(query, { photoUrl: 1 }).lean();
      const urls = votersWithPhotos.map(v => v.photoUrl).filter(Boolean);
      if (urls.length > 0) deleteVoterPhotos(urls).catch(e => console.warn('[voters] Cloudinary bulk delete error:', e.message));
    } catch (cErr) {
      console.warn('[voters] Cloudinary bulk delete error:', cErr.message);
    }

    const result = await Voter.deleteMany(query);

    // Invalidate Cache for this organization
    const orgKey = query.organizationId || req.user.organizationId || 'org_default';
    cache.delPrefix(`voters_all_${orgKey}_`);
    cache.delPrefix(`wards_summary_${orgKey}_`);
    cache.delPrefix(`turnout_summary_${orgKey}_`);

    res.json({ success: true, message: `${result.deletedCount} मतदाता सफलतापूर्वक डिलीट कर दिए गए।`, deletedCount: result.deletedCount });
  } catch (err) {
    console.error('Bulk voter deletion failed:', err.message);
    res.status(500).json({ message: 'डेटा डिलीट करने में त्रुटि आई।' });
  }
});

// EXPLICIT CLIENT PROTECTION: Catch-all for clients trying to delete or post
router.use((req, res, next) => {
  if (req.method === 'DELETE') {
    return res.status(403).json({
      message: 'क्लाइंट्स को डेटा डिलीट करने की अनुमति नहीं है। आप केवल डेटा देख व एडिट कर सकते हैं।'
    });
  }
  if (req.method === 'POST') {
    return res.status(403).json({
      message: 'क्लाइंट्स को नया डेटा अपलोड करने की अनुमति नहीं है। नया डेटा केवल सुपर एडमिन द्वारा अपलोड किया जा सकता है। आप केवल डेटा देख व एडिट कर सकते हैं।'
    });
  }
  next();
});

module.exports = router;
