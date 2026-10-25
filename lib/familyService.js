const { cleanHouseNo } = require('./ocrService');

/**
 * Checks whether a house number is considered missing, unassigned, or invalid
 */
function isMissingHouseNo(houseNo) {
  if (!houseNo) return true;
  const s = String(houseNo).trim().toLowerCase();
  return (
    s === '-' ||
    s === '—' ||
    s === '–' ||
    s === '0' ||
    s === '00' ||
    s === '000' ||
    s === 'null' ||
    s === 'undefined' ||
    s === 'उपलब्ध नहीं' ||
    s === 'लागू नहीं' ||
    s === 'शून्य' ||
    s === 'nil' ||
    s === 'na' ||
    s === 'n/a' ||
    s === 'none' ||
    /^[0०\s\-—\.]+$/.test(s)
  );
}

/**
 * Normalizes relative name for comparison:
 * Strips honorifics (श्री, श्रीमती, स्व., स्वर्गीय, ला., पं.) and whitespace
 */
function normalizePersonName(name) {
  if (!name) return '';
  return String(name)
    .replace(/^(?:श्री|श्रीमती|स्व\.|स्वर्गीय|ला\.|पं\.|डॉ\.|मिस्टर|मिसेज|mr|mrs|late)\s+/gi, '')
    .replace(/[^\u0900-\u097Fa-zA-Z]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Checks whether two voters have a direct familial connection:
 * 1. Shared relative name (father / husband / mother)
 * 2. Cross-generational link (Voter A's name is Voter B's relative name or vice versa)
 * 3. Spouse link (husband/wife relation)
 */
function haveFamilialConnection(v1, v2) {
  if (!v1 || !v2) return false;

  const n1 = normalizePersonName(v1.nameHi || v1.nameEn);
  const n2 = normalizePersonName(v2.nameHi || v2.nameEn);
  const r1 = normalizePersonName(v1.relativeNameHi || v1.relativeNameEn);
  const r2 = normalizePersonName(v2.relativeNameHi || v2.relativeNameEn);

  // 1. Shared relative (e.g. same father or same mother or same husband)
  if (r1 && r2 && r1 === r2) {
    return true;
  }

  // 2. Direct parent/child or husband/wife link
  if (n1 && r2 && n1 === r2) {
    return true;
  }
  if (n2 && r1 && n2 === r1) {
    return true;
  }

  return false;
}

/**
 * High-accuracy Family Grouping Algorithm for Electoral Rolls (चुनव रणनीति)
 * Groups voters into real, accurate families without dumping unrelated people together.
 *
 * Rules:
 * 1. Ward & Part Isolation: Voters must share ward and part.
 * 2. Preserves existing explicit custom familyId (if assigned by user/admin).
 * 3. Voters with MISSING house numbers ('-', '0', empty) are NEVER grouped together
 *    unless they have direct familial ties (shared relative name or parent link) AND
 *    are within close serial proximity (<= 5 serials apart). Unrelated unhoused voters
 *    form individual single-member households.
 * 4. Voters with VALID house numbers form household groups. If a house number is large
 *    (> 8 members) or has disjoint sub-branches with distinct relatives separated by
 *    large serial gaps (> 15 serials), it is cleanly partitioned into sub-families.
 */
function groupVotersIntoFamilies(votersList) {
  if (!Array.isArray(votersList) || votersList.length === 0) {
    return { families: [], voterFamilyMap: new Map() };
  }

  // Partition by Ward and Part
  const partitionMap = new Map();
  votersList.forEach((v) => {
    const ward = String(v.wardNo || '').trim();
    const part = String(v.partNo || '').trim();
    const partitionKey = `${ward}__${part}`;
    if (!partitionMap.has(partitionKey)) {
      partitionMap.set(partitionKey, []);
    }
    partitionMap.get(partitionKey).push(v);
  });

  const allFamilies = [];
  const voterFamilyMap = new Map();

  partitionMap.forEach((votersInPartition, partitionKey) => {
    const [ward, part] = partitionKey.split('__');

    // Sort voters by serialNo
    const sorted = [...votersInPartition].sort((a, b) => {
      const sA = Number.parseInt(a.serialNo, 10) || 0;
      const sB = Number.parseInt(b.serialNo, 10) || 0;
      return sA - sB;
    });

    // Grouping structure for this partition
    const partitionFamilies = [];

    // Separate explicit custom familyId vs auto-grouped
    for (const voter of sorted) {
      const explicitFam = voter.familyId && String(voter.familyId).trim();
      const isAutoFam = explicitFam && explicitFam.startsWith('FAM_');

      // If voter has an explicit manual familyId assigned by user (not auto FAM_), honor it:
      if (explicitFam && !isAutoFam && explicitFam !== 'fam_-' && explicitFam !== 'fam_') {
        let existing = partitionFamilies.find((f) => f.familyId === explicitFam);
        if (!existing) {
          existing = {
            familyId: explicitFam,
            wardNo: ward,
            partNo: part,
            houseNo: voter.houseNo || '-',
            members: [],
            headName: '',
            isManual: true,
          };
          partitionFamilies.push(existing);
        }
        existing.members.push(voter);
        continue;
      }

      const hClean = cleanHouseNo(voter.houseNo);
      const isMissingHouse = isMissingHouseNo(hClean);
      const serial = Number.parseInt(voter.serialNo, 10) || 0;

      let matchedFamily = null;

      if (isMissingHouse) {
        // MISSING HOUSE NUMBER RULE:
        // Must NEVER group together blindly.
        // Can only join an existing missing-house family if:
        // 1. That family also has missing house
        // 2. Serial difference with at least one member is <= 5
        // 3. Direct familial link (shared father/husband or parent-child link)
        for (const fam of partitionFamilies) {
          if (!fam.isMissingHouse) continue;

          const serials = fam.members.map((m) => Number.parseInt(m.serialNo, 10) || 0);
          const minSerial = Math.min(...serials);
          const maxSerial = Math.max(...serials);

          if (serial >= minSerial - 5 && serial <= maxSerial + 5) {
            const hasLink = fam.members.some((m) => haveFamilialConnection(m, voter));
            if (hasLink) {
              matchedFamily = fam;
              break;
            }
          }
        }
      } else {
        // VALID HOUSE NUMBER RULE:
        // Voters with the same clean house number.
        // If a family with this house already exists:
        // - If members <= 8: check if serials are reasonably close (<= 25) or have familial ties.
        // - If gap is huge (> 25) and relatives are completely different, start a new sub-family.
        for (const fam of partitionFamilies) {
          if (fam.isMissingHouse || fam.houseNo !== hClean) continue;

          const serials = fam.members.map((m) => Number.parseInt(m.serialNo, 10) || 0);
          const minSerial = Math.min(...serials);
          const maxSerial = Math.max(...serials);
          const serialDistance = Math.min(Math.abs(serial - minSerial), Math.abs(serial - maxSerial));

          const hasLink = fam.members.some((m) => haveFamilialConnection(m, voter));

          if (fam.members.length < 8) {
            if (hasLink || serialDistance <= 15) {
              matchedFamily = fam;
              break;
            }
          } else if (hasLink && serialDistance <= 25) {
            matchedFamily = fam;
            break;
          }
        }
      }

      if (matchedFamily) {
        matchedFamily.members.push(voter);
      } else {
        // Create new family
        partitionFamilies.push({
          familyId: '', // populated in post-processing
          wardNo: ward,
          partNo: part,
          houseNo: isMissingHouse ? '-' : hClean,
          isMissingHouse,
          members: [voter],
          isManual: false,
        });
      }
    }

    // Post-process each family:
    // Determine family head, assign unique deterministic familyId, sort members
    const houseCounter = new Map();

    for (const fam of partitionFamilies) {
      // Sort members: senior/eldest first or by serial
      fam.members.sort((a, b) => {
        const ageA = Number(a.age) || 0;
        const ageB = Number(b.age) || 0;
        if (ageB !== ageA) return ageB - ageA;
        return (Number(a.serialNo) || 0) - (Number(b.serialNo) || 0);
      });

      // Find the family head:
      // If someone in the family is named as relative (e.g. father/husband) by other members, they are the head!
      let head = fam.members[0];
      for (const m of fam.members) {
        const mNorm = normalizePersonName(m.nameHi || m.nameEn);
        if (!mNorm) continue;
        const referencedCount = fam.members.filter((other) => {
          const rNorm = normalizePersonName(other.relativeNameHi || other.relativeNameEn);
          return rNorm === mNorm;
        }).length;
        if (referencedCount >= 1 && (Number(m.age) || 0) >= 25) {
          head = m;
          break;
        }
      }

      fam.head = head;
      fam.headName = head?.nameHi || head?.nameEn || 'मुखिया';
      fam.memberCount = fam.members.length;

      // Caste & Phone
      const casteMember = fam.members.find((m) => m.caste && m.caste.trim());
      fam.caste = casteMember?.caste || '';

      const phoneMember = fam.members.find((m) => (m.mobileNo || m.phone || '').trim());
      fam.phone = phoneMember?.mobileNo || phoneMember?.phone || '';

      const serials = fam.members.map((m) => Number.parseInt(m.serialNo, 10) || 0).filter(Boolean);
      const minSerial = serials.length > 0 ? Math.min(...serials) : 1;

      // Assign deterministic ID if not manual
      if (!fam.familyId) {
        if (fam.isMissingHouse) {
          fam.familyId = `FAM_W${ward || '0'}_P${part || '0'}_S${minSerial}`;
        } else {
          const cleanH = fam.houseNo.replace(/[^a-zA-Z0-9]/g, '_');
          const count = (houseCounter.get(cleanH) || 0) + 1;
          houseCounter.set(cleanH, count);
          fam.familyId = `FAM_W${ward || '0'}_P${part || '0'}_H${cleanH}${count > 1 ? `_${count}` : ''}`;
        }
      }

      // Map voters to familyId
      for (const m of fam.members) {
        if (m._id) {
          voterFamilyMap.set(String(m._id), fam.familyId);
        }
        if (m.serialNo && ward) {
          voterFamilyMap.set(`${ward}_${part}_${m.serialNo}`, fam.familyId);
        }
        // attach familyId to voter object directly
        m.familyId = fam.familyId;
        m.familyHead = fam.headName;
      }

      allFamilies.push(fam);
    }
  });

  return { families: allFamilies, voterFamilyMap };
}

module.exports = {
  cleanHouseNo,
  isMissingHouseNo,
  normalizePersonName,
  haveFamilialConnection,
  groupVotersIntoFamilies,
};
