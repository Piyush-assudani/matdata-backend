/**
 * Safe Regex & Phonetic Utilities for Chunav Ranniti (चुनाव रणनीति)
 * Prevents regex injection, ReDoS attacks, syntax errors (e.g. '+', '(', '[', '*', '?'),
 * and generates high-accuracy phonetic Devanagari regex for Latin/English search queries.
 */

function sanitizeInput(value, maxLength = 150) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\0/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLength);
}

function escapeRegex(value, maxLength = 150) {
  const safe = sanitizeInput(value, maxLength);
  if (!safe) return '';
  return safe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeRegex(value, flags = 'i', maxLength = 150) {
  const safe = sanitizeInput(value, maxLength);
  if (!safe) return null;
  try {
    return new RegExp(safe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  } catch {
    return null;
  }
}

// Reverse dictionary mapping English names/surnames to Devanagari
const COMMON_REVERSE_DICT = {
  'singh': ['सिंह'],
  'kanwar': ['कंवर'],
  'devi': ['देवी'],
  'bai': ['बाई'],
  'kumar': ['कुमार'],
  'kumari': ['कुमारी'],
  'prasad': ['प्रसाद'],
  'lal': ['लाल'],
  'ram': ['राम'],
  'sharma': ['शर्मा'],
  'vyas': ['व्यास'],
  'joshi': ['जोशी'],
  'dave': ['दवे'],
  'purohit': ['पुरोहित'],
  'rathore': ['राठौड़'],
  'shekhawat': ['शेखावत'],
  'chauhan': ['चौहान'],
  'bhati': ['भाटी'],
  'solanki': ['सोलंकी'],
  'parihar': ['परिहार'],
  'panwar': ['पंवार'],
  'gehlot': ['गेहलोत'],
  'jat': ['जाट'],
  'chaudhary': ['चौधरी'],
  'godara': ['गोदारा'],
  'beniwal': ['बेनीवाल'],
  'punia': ['पूनिया'],
  'dhaka': ['ढाका'],
  'saharan': ['सहारण'],
  'doodi': ['डूडी'],
  'jakhar': ['जाखड़'],
  'gurjar': ['गुर्जर'],
  'mali': ['माली'],
  'saini': ['सैनी'],
  'kumawat': ['कुमावत'],
  'suthar': ['सुथार'],
  'meghwal': ['मेघवाल'],
  'bheel': ['भील'],
  'meena': ['मीणा'],
  'bishnoi': ['बिश्नोई'],
  'yadav': ['यादव'],
  'ahir': ['अहीर'],
  'darji': ['दर्जी'],
  'soni': ['सोनी'],
  'lohar': ['लोहार'],
  'nai': ['नाई'],
  'sen': ['सेन'],
  'prajapat': ['प्रजापत'],
  'prajapati': ['प्रजापति'],
  'jain': ['जैन'],
  'agarwal': ['अग्रवाल'],
  'maheshwari': ['माहेश्वरी'],
  'oswal': ['ओसवाल'],
  'rajput': ['राजपूत'],
  'brahmin': ['ब्राह्मण'],
  'tiwari': ['तिवारी'],
  'mishra': ['मिश्रा'],
  'pandey': ['पांडेय'],
  'shukla': ['शुक्ला'],
  'dubey': ['दुबे'],
  'tripathi': ['त्रिपाठी'],
  'patel': ['पटेल'],
  'patidar': ['पाटीदार'],
  'raika': ['रायका'],
  'rabari': ['रबारी'],
  'dewasi': ['देवासी'],
  'suresh': ['सुरेश'],
  'ramesh': ['रमेश'],
  'dinesh': ['दिनेश'],
  'mukesh': ['मुकेश'],
  'rakesh': ['राकेश'],
  'rajesh': ['राजेश'],
  'mahesh': ['महेश'],
  'om': ['ओम'],
  'omkash': ['ओमप्रकाश'],
  'om prakash': ['ओम प्रकाश'],
  'budh': ['बुधा', 'बुधाराम'],
  'budha': ['बुधा'],
  'budharam': ['बुधाराम'],
  'babu': ['बाबू'],
  'babulal': ['बाबूलाल'],
  'kalki': ['कालकी'],
  'hanuman': ['हनुमान'],
  'hanumanram': ['हनुमानराम'],
  'kalaram': ['कलाराम'],
  'dungarram': ['डुंगरराम'],
  'mangal': ['मंगला', 'मंगलाराम'],
  'mangalaram': ['मंगलाराम'],
  'ghewar': ['घेवर'],
  'ghewarram': ['घेवरराम'],
  'arjun': ['अर्जुन'],
  'harish': ['हरीश'],
  'narayan': ['नारायण'],
  'kanaram': ['कानाराम'],
  'nemichand': ['नेमीचंद'],
  'nemi': ['नेमी', 'नेमीचंद'],
  'dhudi': ['धुडी'],
  'shanti': ['शांति', 'शान्ति', 'शांती', 'शान्तिदेवी'],
  'ganga': ['गंगा'],
  'pratap': ['प्रताप', 'प्रतापजी', 'प्रतापराम'],
  'pratapji': ['प्रतापजी'],
  'pratapram': ['प्रतापराम'],
  'rekha': ['रेखा'],
  'dhapu': ['धापू'],
  'mahendra': ['महेन्द्र', 'महेंद्र'],
  'pappu': ['पप्पू', 'पपुदास', 'पपपू'],
  'pooja': ['पूजा'],
  'pankaj': ['पंकज'],
  'pawani': ['पवनी'],
  'pawan': ['पवन'],
  'kanta': ['कांता', 'कान्ता'],
  'manju': ['मंजू', 'मन्जू'],
  'santosh': ['संतोष'],
  'sunita': ['सुनीता', 'सुनिता'],
  'geeta': ['गीता'],
  'kamal': ['कमल'],
  'kailash': ['कैलाश'],
  'mohan': ['मोहन', 'मोहनदास'],
  'mohandas': ['मोहनदास', 'मोहन'],
  'sohan': ['सोहन'],
  'pushpa': ['पुष्पा'],
  'pukhraj': ['पुखराज', 'पूखराज'],
  'paras': ['पारस'],
  'prem': ['प्रेम', 'प्रेमदास'],
  'bhoora': ['भूरा', 'भूराराम'],
  'bhooraram': ['भूराराम'],
  'bhupendra': ['भुपेन्द्र', 'भूपेन्द्र', 'भूपेन्न', 'भुपेन्न'],
  'dinesh': ['दिनेश', 'तिनेश'],
  'tinesh': ['तिनेश', 'दिनेश'],
  'devi': ['देवी', 'तेवी'],
  'tevi': ['तेवी', 'देवी'],
  'das': ['दास', 'तास'],
  'tas': ['तास', 'दास'],
  'devendra': ['देवेन्द्र', 'तेवेन्द्र'],
  'divya': ['दिव्या', 'तिव्या'],
  'durga': ['दुर्गा', 'तुर्गा'],
  'deva': ['देवा', 'तेवा'],
  'devaram': ['देवाराम', 'तेवाराम'],
  'dewasi': ['देवासी', 'तेवासी'],
  'dashrath': ['दशरथ', 'तशरथ'],
  'deepak': ['दीपक', 'तीपक'],
  'deepika': ['दीपिका', 'तीपिका'],
  'dilip': ['दिलीप', 'तिलीप'],
  'dayanand': ['दयानन्द', 'तयानन्द'],
  'gautam': ['गौतम', 'गलतम', 'गलतमचन्द'],
  'bhagta': ['भगता', 'वगता', 'वगताराम'],
  'bishna': ['बिशना', 'विशना', 'विशनाराम'],
  'rinku': ['रिंकू', 'ररकू'],
  'renu': ['रेणु', 'रेनू'],
  'seema': ['सीमा'],
  'neetu': ['नीतू'],
  'priya': ['प्रिया'],
  'sapna': ['सपना'],
  'kamla': ['कमला'],
  'sheela': ['शीला'],
  'dimple': ['डिम्पल'],
  'khushboo': ['खुशबू'],
  'anjana': ['अंजना'],
  'pinki': ['पिंकी'],
};

/**
 * Generates an array of Devanagari regex / search patterns for a Latin/English input
 * E.g., 'bu' -> ['बुधाराम', 'बुधा', /^[बभ][उऊुू]?/i]
 */
function getDevanagariSearchPatterns(latinInput) {
  if (!latinInput || typeof latinInput !== 'string') return [];
  const clean = sanitizeInput(latinInput, 60).toLowerCase();
  // Only process if ASCII letters/digits/spaces
  if (!clean || !/^[a-z0-9\s]+$/i.test(clean)) return [];

  const patterns = [];

  // 1. Direct or prefix dictionary matches
  for (const [enKey, hiList] of Object.entries(COMMON_REVERSE_DICT)) {
    if (enKey === clean || enKey.startsWith(clean)) {
      for (const hi of hiList) {
        if (!patterns.includes(hi)) patterns.push(hi);
      }
    }
  }

  // 2. Phonetic Regex construction
  const multiChar = [
    { en: 'chh', de: 'छ' },
    { en: 'kh', de: 'ख' },
    { en: 'gh', de: 'घ' },
    { en: 'ch', de: '[चछ]' },
    { en: 'jh', de: 'झ' },
    { en: 'th', de: '[थठ]' },
    { en: 'dh', de: '[धढ]' },
    { en: 'ph', de: '[फफ़]' },
    { en: 'bh', de: 'भ' },
    { en: 'sh', de: '[शष]' },
    { en: 'ee', de: '[ईी]' },
    { en: 'oo', de: '[ऊू]' },
    { en: 'ai', de: '[ऐै]' },
    { en: 'au', de: '[औौ]' },
    { en: 'aa', de: '[आा]' },
    { en: 'ngh', de: 'ंह' },
  ];

  const singleChar = {
    'a': '[अआा]',
    'b': '[बभ]',
    'c': '[कच]',
    'd': '[दधडढ]्?',
    'e': '[एे]',
    'f': '[फफ़]',
    'g': '[गघ]',
    'h': 'ह',
    'i': '[इईिी]',
    'j': '[जज़झ]',
    'k': '[कख]्?',
    'l': '[लळ]्?',
    'm': '[मं]्?',
    'n': '[नणङञं]्?',
    'o': '[ओो]',
    'p': '[पफ]्?',
    'q': 'क',
    'r': '(?:[रऋड़ढ़]|र्|्र)्?',
    's': '[सशष]्?',
    't': '[तथटठ]्?',
    'u': '[उऊुू]',
    'v': '[व]्?',
    'w': '[व]्?',
    'y': '[य]',
    'z': '[ज़ज]',
  };

  let pat = '';
  let i = 0;
  while (i < clean.length) {
    if (clean[i] === ' ') {
      pat += '\\s+';
      i++;
      continue;
    }
    let matchedMulti = false;
    for (const m of multiChar) {
      if (clean.startsWith(m.en, i)) {
        pat += m.de;
        i += m.en.length;
        matchedMulti = true;
        break;
      }
    }
    if (!matchedMulti) {
      const char = clean[i];
      pat += singleChar[char] || char;
      i++;
    }
  }

  if (pat) {
    patterns.push(pat);
  }

  return patterns;
}

/**
 * Returns a combined RegExp matching Devanagari representation of Latin input
 */
function latinToDevanagariRegex(latinInput) {
  const patterns = getDevanagariSearchPatterns(latinInput);
  if (!patterns || patterns.length === 0) return null;

  try {
    // Combine exact dictionary terms and phonetic pattern into an alternation
    const combined = patterns
      .map((p) => {
        // If it's already a regex fragment (contains regex brackets), keep as is
        if (p.includes('[') || p.includes('(')) return p;
        // Otherwise escape plain words
        return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('|');

    return new RegExp(combined, 'i');
  } catch {
    return null;
  }
}

module.exports = {
  escapeRegex,
  safeRegex,
  sanitizeInput,
  getDevanagariSearchPatterns,
  latinToDevanagariRegex,
};
