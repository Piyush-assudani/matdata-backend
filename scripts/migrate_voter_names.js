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
  let result = '';
  const len = word.length;

  for (let i = 0; i < len; i++) {
    const char = word[i];
    const nextChar = i + 1 < len ? word[i + 1] : '';

    if (VOWELS[char]) {
      result += VOWELS[char];
      continue;
    }

    if (CONSONANTS[char]) {
      const base = CONSONANTS[char];

      if (nextChar === HALANT) {
        result += base;
        i++;
        continue;
      }

      if (nextChar === '़') {
        let nuktaBase = base;
        if (char === 'ड') nuktaBase = 'd';
        else if (char === 'ढ') nuktaBase = 'dh';
        else if (char === 'ज') nuktaBase = 'z';
        else if (char === 'फ') nuktaBase = 'f';
        i++;
        
        const afterNukta = i + 1 < len ? word[i + 1] : '';
        if (afterNukta === HALANT) {
          result += nuktaBase;
          i++;
        } else if (MATRAS[afterNukta]) {
          let matraEn = MATRAS[afterNukta];
          if (afterNukta === 'ी' && (i + 2 >= len || word[i + 2] === ' ')) matraEn = 'i';
          if (afterNukta === 'ू' && (i + 2 >= len || word[i + 2] === ' ')) matraEn = 'u';
          result += nuktaBase + matraEn;
          i++;
        } else if (i === len - 1) {
          result += nuktaBase;
        } else {
          result += nuktaBase + 'a';
        }
        continue;
      }

      if (MATRAS[nextChar]) {
        let matraEn = MATRAS[nextChar];
        if (nextChar === 'ी' && (i + 2 >= len || word[i + 2] === ' ')) matraEn = 'i';
        if (nextChar === 'ू' && (i + 2 >= len || word[i + 2] === ' ')) matraEn = 'u';
        result += base + matraEn;
        i++;
        continue;
      }

      if (i === len - 1) {
        result += base;
      } else {
        result += base + 'a';
      }
      continue;
    }

    if (MATRAS[char]) {
      result += MATRAS[char];
      continue;
    }

    result += char;
  }

  if (result.length > 0) {
    return result.charAt(0).toUpperCase() + result.slice(1).toLowerCase();
  }
  return result;
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

    // Fix nameEn if it contains Devanagari or is empty
    const hasHindiInNameEn = /[\u0900-\u097F]/.test(rawEn) || !rawEn.trim();
    if (hasHindiInNameEn && (cleanHi || rawHi)) {
      const correctNameEn = transliterateDevanagari(cleanHi || rawHi);
      if (correctNameEn && correctNameEn !== rawEn) {
        updateDoc.nameEn = correctNameEn;
        enChanges++;
        needsUpdate = true;
      }
    }

    // Fix relativeNameEn if it contains Devanagari or is empty
    const hasHindiInRelEn = /[\u0900-\u097F]/.test(rawRelEn) || !rawRelEn.trim();
    if (hasHindiInRelEn && (cleanRelHi || rawRelHi)) {
      const correctRelEn = transliterateDevanagari(cleanRelHi || rawRelHi);
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
