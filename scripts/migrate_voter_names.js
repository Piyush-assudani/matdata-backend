const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { fixCorruptedHindi } = require('../lib/hindiDictionary');

// Parse transliterate.ts from frontend so backend has the exact identical transliteration engine
const tsContent = fs.readFileSync(path.join(__dirname, '../../frontend/src/lib/transliterate.ts'), 'utf8');

// Extract dictionary keys and values
const dictMatch = tsContent.match(/export const INDIAN_NAMES_DICT: Record<string, string> = {([\s\S]*?)};\n\nconst VOWELS:/);
const INDIAN_NAMES_DICT = {};
if (dictMatch) {
  const lines = dictMatch[1].split('\n');
  for (const line of lines) {
    const m = line.match(/'([^']+)':\s*'([^']+)'/);
    if (m) {
      INDIAN_NAMES_DICT[m[1]] = m[2];
    }
  }
}

const VOWELS = {
  'अ': 'A', 'आ': 'Aa', 'इ': 'I', 'ई': 'Ee', 'उ': 'U', 'ऊ': 'Oo', 'ऋ': 'Ri',
  'ए': 'E', 'ऐ': 'Ai', 'ओ': 'O', 'औ': 'Au', 'अं': 'An', 'अः': 'Ah',
};

const MATRAS = {
  'ा': 'a', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ं': 'n', 'ँ': 'n', 'ः': 'h',
};

const CONSONANTS = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'क्ष': 'ksh', 'त्र': 'tr', 'ज्ञ': 'gy',
  'ड़': 'd', 'ढ़': 'dh', 'फ़': 'f', 'ज़': 'z', 'क़': 'q', 'ख़': 'kh', 'ग़': 'gh',
  'ड़': 'd', 'ढ़': 'dh'
};

const HALANT = '्';

function transliteratePhonetic(word) {
  if (!word) return '';
  const clean = word.trim();
  if (!clean) return '';

  const chars = Array.from(clean);
  const units = [];
  let i = 0;
  const n = chars.length;

  while (i < n) {
    const c = chars[i];
    const next = i + 1 < n ? chars[i + 1] : '';

    const combinedNukta = c + next;
    if (CONSONANTS[combinedNukta]) {
      i += 2;
      let matra = '';
      if (i < n && MATRAS[chars[i]]) {
        matra = chars[i]; i++;
      } else if (i < n && chars[i] === HALANT) {
        matra = HALANT; i++;
      }
      units.push({ type: 'CONS', char: combinedNukta, base: CONSONANTS[combinedNukta], matra });
      continue;
    }

    if (VOWELS[c]) {
      let matra = '';
      if (next === 'ं' || next === 'ँ') { matra = next; i++; }
      units.push({ type: 'VOWEL', char: c, base: VOWELS[c], matra });
      i++;
    } else if (CONSONANTS[c]) {
      let base = CONSONANTS[c];
      if (c === 'फ' && (clean.startsWith('फतेह') || clean.startsWith('फारू') || clean.startsWith('फिरो') || clean.startsWith('फैज') || clean.startsWith('फकी'))) {
        base = 'f';
      }
      i++;
      let matra = '';
      if (i < n && MATRAS[chars[i]]) {
        matra = chars[i]; i++;
      } else if (i < n && chars[i] === HALANT) {
        matra = HALANT; i++;
      }
      units.push({ type: 'CONS', char: c, base, matra });
    } else if (MATRAS[c]) {
      units.push({ type: 'OTHER', char: c, base: MATRAS[c], matra: '' });
      i++;
    } else {
      units.push({ type: 'OTHER', char: c, base: c, matra: '' });
      i++;
    }
  }

  let out = '';
  const numUnits = units.length;

  for (let uIdx = 0; uIdx < numUnits; uIdx++) {
    const u = units[uIdx];
    if (u.type === 'OTHER') {
      out += u.base;
      continue;
    }
    if (u.type === 'VOWEL') {
      let vStr = out.length === 0 ? u.base : u.base.toLowerCase();
      if (u.matra === 'ं' || u.matra === 'ँ') vStr += 'n';
      out += vStr;
      continue;
    }

    let base = u.base;
    if (u.matra === HALANT) {
      out += base;
      continue;
    }

    if (u.matra) {
      let matraStr = MATRAS[u.matra] || '';
      if (u.matra === 'ी' && (uIdx === numUnits - 1 || (uIdx === numUnits - 2 && ['दान', 'राम', 'लाल'].includes(units[numUnits - 1]?.char)))) {
        matraStr = 'i';
      } else if (u.matra === 'ू' && uIdx === numUnits - 1) {
        matraStr = 'u';
      } else if (u.matra === 'ं' || u.matra === 'ँ') {
        const nextU = uIdx + 1 < numUnits ? units[uIdx + 1] : null;
        if (nextU && nextU.type === 'CONS') {
          const nextC = nextU.char;
          if (['प', 'फ', 'ब', 'भ', 'म', 'फ़'].includes(nextC)) matraStr = 'am';
          else if (['क', 'ख', 'ग', 'घ'].includes(nextC)) matraStr = 'ang';
          else matraStr = 'an';
        } else {
          matraStr = (uIdx === numUnits - 1) ? 'on' : 'an';
        }
      }
      out += base + matraStr;
      continue;
    }

    const isLast = (uIdx === numUnits - 1);
    if (isLast) {
      if (base === 'dr' || base === 'ndr') {
        out += base + 'a';
      } else {
        out += base;
      }
      continue;
    }

    const nextU = units[uIdx + 1];
    const prevU = uIdx > 0 ? units[uIdx - 1] : null;
    let deleteSchwa = false;

    if (nextU && nextU.type === 'CONS' && nextU.matra === HALANT) {
      deleteSchwa = false;
    } else if (nextU && nextU.type === 'CONS' && nextU.matra) {
      if (prevU && prevU.matra !== HALANT) {
        deleteSchwa = true;
      }
    } else if (nextU && nextU.type === 'CONS' && (nextU.char === 'र' || nextU.char === 'ल') && numUnits >= 4) {
      if (uIdx >= 2) deleteSchwa = true;
    }

    out += deleteSchwa ? base : (base + 'a');
  }

  if (out.length > 0) {
    return out.charAt(0).toUpperCase() + out.slice(1).toLowerCase();
  }
  return out;
}

function transliterateSingleWord(word) {
  if (!word) return '';
  const clean = fixCorruptedHindi(word);
  if (!clean) return '';

  if (INDIAN_NAMES_DICT[clean]) {
    return INDIAN_NAMES_DICT[clean];
  }

  const compoundSuffixes = [
    { suffix: 'जी', en: 'ji' },
    { suffix: 'लाल', en: 'lal' },
    { suffix: 'राम', en: 'ram' },
    { suffix: 'चंद', en: 'chand' },
    { suffix: 'चन्द', en: 'chand' },
    { suffix: 'सिंह', en: 'singh' },
    { suffix: 'कंवर', en: 'kanwar' },
    { suffix: 'देवी', en: 'devi' },
    { suffix: 'तेवी', en: 'devi' },
    { suffix: 'बाई', en: 'bai' },
    { suffix: 'कुमार', en: 'kumar' },
    { suffix: 'कुमारी', en: 'kumari' },
    { suffix: 'प्रसाद', en: 'prasad' },
    { suffix: 'स्वरूप', en: 'swaroop' },
    { suffix: 'प्रकाश', en: 'prakash' },
    { suffix: 'नारायण', en: 'narayan' },
    { suffix: 'दास', en: 'das' },
    { suffix: 'तास', en: 'das' },
    { suffix: 'दीन', en: 'deen' },
    { suffix: 'पाल', en: 'pal' },
    { suffix: 'मल', en: 'mal' },
    { suffix: 'राज', en: 'raj' },
    { suffix: 'सेन', en: 'sen' },
    { suffix: 'भान', en: 'bhan' },
    { suffix: 'दत्त', en: 'datt' },
    { suffix: 'भगत', en: 'bhagat' },
    { suffix: 'बानों', en: 'bano' },
    { suffix: 'बानो', en: 'bano' },
    { suffix: 'बानू', en: 'bano' },
    { suffix: 'बेगम', en: 'begum' },
    { suffix: 'खान', en: 'khan' },
    { suffix: 'खां', en: 'khan' },
    { suffix: 'वती', en: 'vati' },
    { suffix: 'मती', en: 'mati' },
    { suffix: 'शंकर', en: 'shankar' },
    { suffix: 'नाथ', en: 'nath' },
    { suffix: 'करण', en: 'karan' },
    { suffix: 'जीत', en: 'jeet' },
    { suffix: 'प्रीत', en: 'preet' },
    { suffix: 'दीप', en: 'deep' },
    { suffix: 'वीर', en: 'veer' },
    { suffix: 'चंद्र', en: 'chandra' },
    { suffix: 'चन्द्र', en: 'chandra' },
    { suffix: 'वर', en: 'war' },
    { suffix: 'पुरी', en: 'puri' },
    { suffix: 'पूरी', en: 'puri' },
  ];

  for (const { suffix, en } of compoundSuffixes) {
    if (clean.endsWith(suffix) && clean.length > suffix.length) {
      const prefix = clean.slice(0, clean.length - suffix.length);
      const prefixTrans = INDIAN_NAMES_DICT[prefix] || transliteratePhonetic(prefix);
      return prefixTrans + en.toLowerCase();
    }
  }

  return transliteratePhonetic(clean);
}

function transliterateDevanagari(text) {
  if (!text || typeof text !== 'string') return '';
  const trimmed = fixCorruptedHindi(text);
  if (!trimmed) return '';

  const words = trimmed.split(/\s+/);
  return words.map(w => transliterateSingleWord(w)).join(' ');
}

async function migrateVoterNames() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set in .env');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('Connected!');

  const collection = mongoose.connection.collection('voters');
  const allVoters = await collection.find({}).project({
    _id: 1,
    nameHi: 1,
    nameEn: 1,
    relativeNameHi: 1,
    relativeNameEn: 1
  }).toArray();

  console.log(`Analyzing ${allVoters.length} voters...`);

  const ops = [];
  let hiChanges = 0;
  let enChanges = 0;

  for (const v of allVoters) {
    const rawHi = v.nameHi || '';
    const rawRelHi = v.relativeNameHi || '';
    const rawEn = v.nameEn || '';
    const rawRelEn = v.relativeNameEn || '';

    const cleanHi = fixCorruptedHindi(rawHi);
    const cleanRelHi = fixCorruptedHindi(rawRelHi);

    let needsUpdate = false;
    const updateDoc = {};

    if (cleanHi && cleanHi !== rawHi) {
      updateDoc.nameHi = cleanHi;
      hiChanges++;
      needsUpdate = true;
    }
    if (cleanRelHi && cleanRelHi !== rawRelHi) {
      updateDoc.relativeNameHi = cleanRelHi;
      hiChanges++;
      needsUpdate = true;
    }

    // Always ensure nameEn matches authentic clean Hindi name
    if (cleanHi) {
      const correctNameEn = transliterateDevanagari(cleanHi);
      if (correctNameEn && correctNameEn !== rawEn) {
        updateDoc.nameEn = correctNameEn;
        enChanges++;
        needsUpdate = true;
      }
    }

    // Always ensure relativeNameEn matches authentic clean Hindi relative name
    if (cleanRelHi) {
      const correctRelEn = transliterateDevanagari(cleanRelHi);
      if (correctRelEn && correctRelEn !== rawRelEn) {
        updateDoc.relativeNameEn = correctRelEn;
        enChanges++;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      ops.push({
        updateOne: {
          filter: { _id: v._id },
          update: { $set: updateDoc }
        }
      });
    }
  }

  console.log(`Total documents needing update: ${ops.length}`);
  console.log(`Hindi spelling corrections: ${hiChanges}`);
  console.log(`English transliteration updates: ${enChanges}`);

  if (ops.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < ops.length; i += batchSize) {
      const batch = ops.slice(i, i + batchSize);
      const res = await collection.bulkWrite(batch);
      console.log(`Batch ${Math.floor(i / batchSize) + 1}: modified ${res.modifiedCount} records`);
    }
  }

  console.log('Voter name migration finished successfully!');
  process.exit(0);
}

migrateVoterNames().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
