const Tesseract = require('tesseract.js');
const { pdfToPng } = require('pdf-to-png-converter');

/**
 * Devanagari to Arabic numeral normalization
 */
const DEV_NUMS = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'
};

function normalizeDevanagariNumerals(str) {
  if (!str) return "";
  let out = str;
  for (const [dev, arb] of Object.entries(DEV_NUMS)) {
    out = out.split(dev).join(arb);
  }
  return out;
}

const SEC_RAJASTHAN_DICTIONARY = {
  'दकरल': 'देवी', 'दकर': 'देव', 'लरल': 'लाल', 'ररम': 'राम', 'कचमरर': 'कुमार', 'कचमररल': 'कुमारी',
  'सयहनलरल': 'सोहनलाल', 'सयहन': 'सोहन', 'दकशनलरल': 'किशनलाल', 'दकशन': 'किशन', 'ककलरश': 'कैलाश',
  'मरपगललरल': 'मांगीलाल', 'चमपरलरल': 'चम्पालाल', 'चमपर': 'चम्पा', 'ककसरररम': 'केसाराम', 'छकलरररम': 'छैलाराम',
  'छकलर': 'छैला', 'ककसल': 'केसी', 'सरसल': 'सरसी', 'सलतर': 'सीता', 'सपगलतर': 'संगीता', 'शयभर': 'शोभा',
  'मरलल': 'माली', 'सचआ': 'सुआ', 'पकमलल': 'कमला', 'कमलल': 'कमला', 'मपगलर': 'मंगला', 'मपगरररम': 'मगाराम',
  'गपगर': 'गंगा', 'खखररररम': 'खींयाराम', 'करलबररम': 'कालूराम', 'करलच': 'कालू', 'परलररजर': 'परिहार',
  'ररजकश': 'राजेश', 'महकनद': 'महेंद्र', 'जललर': 'झल्लार', 'हलररलरल': 'हीरालाल', 'बरबचलरल': 'बाबूलाल',
  'नशरपकरश': 'शिवप्रकाश', 'सचनमतरर': 'सुमित्रा', 'दचगरर': 'दुर्गा', 'शमरर': 'शर्मा', 'ररधर': 'राधा',
  'नजततद': 'जितेंद्र', 'झबमर': 'झूमर', 'सचरकश': 'सुरेश', 'बरधचदकरल': 'बाधुदेवी', 'नतसच': 'नत्थू',
  'हरखरररम': 'हरखाराम', 'बपसललरल': 'बंसीलाल', 'जकठरररम': 'जेठाराम', 'हकमलतर': 'हेमलता',
  'तकज': 'तेज', 'पकरश': 'प्रकाश', 'अनचपर': 'अनुपा', 'सचतरर': 'सुतार', 'ककसबररम': 'केसूराम',
  'उषर': 'उषा', 'पपचर': 'पांचू', 'ककषनररम': 'कृष्णाराम', 'ककषनर': 'कृष्णा', 'मनकष': 'मनीष',
  'मनयज': 'मनोज', 'सपजय': 'संजय', 'नदपक': 'दीपक', 'पपर': 'पूजा', 'पपम': 'पूनम', 'रखम': 'रेखा',
  'भपरर': 'भंवरा', 'भपरररम': 'भंवराराम', 'महनपल': 'महिपाल', 'हसतमल': 'हस्तीमल', 'ओमपकरश': 'ओमप्रकाश',
  'ररमदनल': 'रामदीन', 'ररमचचदर': 'रामचंद्र', 'भगररथरम': 'भागीरथराम', 'भगररथ': 'भागीरथ'
};

function decodeSecRajasthanFont(text) {
  if (!text) return '';
  let s = text.replace(/^(?:[नहकम]\s+)+/g, '').trim();

  const sortedKeys = Object.keys(SEC_RAJASTHAN_DICTIONARY).sort((a, b) => b.length - a.length);
  for (const k of sortedKeys) {
    if (s.includes(k)) {
      s = s.split(k).join(SEC_RAJASTHAN_DICTIONARY[k]);
    }
  }

  s = s.replace(/लरल/g, 'लाल');
  s = s.replace(/ररम/g, 'राम');
  s = s.replace(/दकरल/g, 'देवी');
  s = s.replace(/कचमरर/g, 'कुमार');

  s = s.replace(/([क-ह])य([क-ह])/g, '$1ो$2');
  s = s.replace(/([क-ह])प([क-ह])/g, '$1ं$2');
  s = s.replace(/([क-ह])क([क-ह])/g, '$1े$2');
  s = s.replace(/([क-ह])च([क-ह])/g, '$1ु$2');
  s = s.replace(/([क-ह])ब([क-ह])/g, '$1ू$2');

  s = s.replace(/रर/g, 'रा');
  s = s.replace(/([क-ह])र(?=\s|$)/g, '$1ा');
  s = s.replace(/([क-ह])ल(?=\s|$)/g, '$1ी');

  s = s.replace(/ा+/g, 'ा').replace(/ी+/g, 'ी').replace(/े+/g, 'े');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Clean unwanted artifacts from extracted Hindi text strings
 */
function cleanHindiText(str) {
  if (!str) return "";
  let n = decodeSecRajasthanFont(normalizeDevanagariNumerals(str)).trim();
  
  // Strip anything before or ending in 'नाम' or SEC 'नरम' (label bleed)
  if (n.includes('नाम')) {
    const parts = n.split('नाम');
    const after = parts[parts.length - 1].trim();
    if (after.length >= 2) {
      n = after;
    }
  }
  if (n.includes('नरम')) {
    const parts = n.split('नरम');
    const after = parts[parts.length - 1].trim();
    if (after.length >= 2) {
      n = after;
    }
  }

  // Remove leading colons, hyphens, slashes, or noise
  n = n.replace(/^[:ः\-\.\s\/\|]+/g, '');

  // Remove leading OCR noise or label prefixes (e.g. 'ava:', 'ara:', 'नाम:', 'पिता:', 'पति:', 'मतदाता का नाम:')
  n = n.replace(/^(?:ava|ara|name|no|sl|s|voter|nam|na|sn|cr|नरम|त्ताम|त्ाम|ताम|नाम्|नाभ|माम|नाव|ना|ता|मा|ज्ञाञ्|ज्ञा|साभ|जप्र|ज्ञात)?[:\-\.\s]+/gi, '');
  
  // Strip misread label prefixes (e.g. 'किया', 'क्या', 'या', 'नि', 'नी', 'पी', 'फेम', 'ग्राम', etc.)
  n = n.replace(/^(?:किया|क्या|या|नि|नी|पी|फी|मी|गी|सी|दी|जा|फेम|ग्राम|प्राम|ताम|बाम|दाम|माप|प्र|मा|भा|का|मो|त्ताम|त्ाम|साभ|जप्र)\s+/g, '');
  n = n.replace(/^(?:मकान|गृह)\s*(?:संख्या)?\s*[:ः\-\.\s]+/gi, '');

  // Strictly remove English / Latin characters (English not permitted in Hindi name)
  n = n.replace(/[a-zA-Z]+/g, ' ');

  // Strictly remove digits (numbers not permitted in name)
  n = n.replace(/[\d\u0966-\u096F]+/g, ' ');

  // Strip non-Devanagari symbols and punctuation
  n = n.replace(/[\|\[\]\(\)\{\}«»®©\'\"\‘\’\`\.\,\^°+।॥~!\?=\+\*&%\$#@;:\/\\_\-¢¥<>०]+/g, ' ');

  // Truncate if subsequent field labels leaked into name
  n = n.split(/\s+(?:(?:पिता|पति|माता|अन्य|नातेदार)\s*(?:का)?\s*नाम|(?:मकान|गृह)\s*(?:संख्या)?|(?:आयु|उम्र)\s*[:ः\-]?\s*\d+|(?:लिंग|Sex)\s*[:ः\-]?\s*(?:पुरुष|स्त्री|महिला|male|female))\b/i)[0];

  const labelBleed = [
    /\s+(?:नाम|नाम्|नाभ|मतदाता|पिता|पति|माता|अन्य|नातेदार|संबंधी|पित|मका|मकान|गृह|है|हे|कै|ब्|र्|म्|न्|न|प|व|क|गम|हक|रत|हि|क्|ख|लक|खख|पु|Photo|Available|is|Avail|Ph|Av|P|A)$/i,
    /^(?:श्री|श्रीमती|सुश्री|डॉ|डा)\s+/i
  ];

  let changed = true;
  while (changed) {
    changed = false;
    let nC = n.trim();
    for (const pat of labelBleed) {
      const newN = nC.replace(pat, '').trim();
      if (newN !== nC) {
        nC = newN;
        changed = true;
      }
    }
    n = nC;
  }

  // Strip trailing noise tokens / fragments
  const tokens = n.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && (tokens[tokens.length - 1].length <= 2 && ['के', 'कर', 'द', 'ह', 'ष', 'ु', 'ख', 'क', 'ग', 'घ', 'त', 'र', 'स', 'ल', 'म', 'न', 'प', 'व', 'य', 'है', 'हे', 'की', 'का', 'पर'].includes(tokens[tokens.length - 1]))) {
    tokens.pop();
  }
  n = tokens.join(' ');

  // Normalize common OCR typos in Devanagari (F4)
  n = n.replace(/लालन$/, 'लाल');
  n = n.replace(/^झोहन/, 'सोहन');
  n = n.replace(/^[भाा]ंगीलाल/, 'मांगीलाल');
  n = n.replace(/^(?:श्च|त्)म्पा/, 'चम्पा');
  n = n.replace(/^हहरी\s*राम/, 'हरी राम');
  n = n.replace(/^हरीयजर/, 'हरीराम');
  n = n.replace(/हरीराप/, 'हरीराम');
  n = n.replace(/^झुरेश/, 'सुरेश');
  n = n.replace(/^क़ेशा/, 'केशा');
  n = n.replace(/^क़ेसूराम|^केस[ूु]राम/, 'केसूराम');
  n = n.replace(/^उषा\s+सतार/, 'उषा सुतार');
  n = n.replace(/^सुमित्रा\s+जांगिड/, 'सुमित्रा जांगिड़');
  n = n.replace(/^हितेश\s*कुछ[ाौ]रे/, 'हितेश कुमार');
  n = n.replace(/^मुकेश\s*कुक[र]?/, 'मुकेश कुमार');
  // Universal Devanagari Phonetic & Matra Normalization (Applies to all names dynamically)
  n = n.replace(/[\u200B-\u200D\uFEFF]/g, ''); // Strip zero-width invisible noise
  n = n.replace(/([ािीुूृेैोौं]+)\1+/g, '$1'); // Deduplicate consecutive identical matras
  n = n.replace(/्(?=\s|$)/g, ''); // Strip floating trailing halants at word ends
  n = n.replace(/^[_\-:;.,~|'"`]+\s*/, ''); // Strip leading punctuation noise
  n = n.replace(/\s*[_\-:;.,~|'"`]+$/, ''); // Strip trailing punctuation noise
  n = n.replace(/^(?:नाम|नाम्म|नेम|नााम)[:\s\-]+/, ''); // Strip stray label prefixes

  n = n.replace(/[^\u0900-\u097F\s]/g, ' ');
  const cleaned = n.replace(/\s+/g, ' ').trim();

  // Reject administrative words accidentally captured as names
  const banned = ['मतदाता', 'कलेण्डर', 'विधानसभा', 'निर्वाचक', 'नामावली', 'वार्ड', 'अनुभाग', 'प्रारूप', 'मतदान', 'हस्ताक्षर', 'फोटो', 'उपलब्ध', 'संख्या', 'भाग', 'सूची', 'ग्राम', 'नगर', 'मकान', 'गृह', 'आयु', 'उम्र', 'लिंग', 'पिता', 'पति', 'माता', 'अन्य', 'नातेदार', 'हु', 'है', 'हे', 'की', 'का', 'के', 'नाम'];
  if (banned.includes(cleaned) || cleaned.length < 2 || (cleaned.replace(/\s+/g, '').length <= 2 && ['हु', 'है', 'हे', 'की', 'का', 'के', 'में', 'से', 'को', 'पर'].includes(cleaned))) {
    return "";
  }
  if (['विधानसभा', 'निर्वाचक', 'नामावली', 'कलेण्डर', 'प्रारूप', 'मतदान केंद्र', 'हस्ताक्षर', 'अनुभाग विवरण', 'मतदाताओं', 'मकरन', 'मकान', 'सपखजर', 'सपखजा', 'नपतर', 'पनत', 'मरतर', 'आजच', 'सलग'].some(bw => cleaned.includes(bw))) {
    return "";
  }
  return cleaned;
}

function cleanHouseNo(str) {
  if (!str) return "-";
  let s = normalizeDevanagariNumerals(String(str)).trim();
  if (/लागू नहीं|उपलब्ध नहीं|शून्य|nil|na|none|n\/a/i.test(s)) {
    return "-";
  }
  s = s.replace(/^(?:मकान|संख्या|मकरन|सपखजर|सपखसर|गृह|आयु|उम्र|लिंग|पुरुष|पुरूष|स्त्री|महिला|नाम|पिता|पति|माता|ward|house|no|room|flat|ft|at|et|Fy|Ik|iad|है|हे|मिका|पु|Nha|AY)[:ः\.\-\s]*/gi, '');
  s = s.replace(/^(?:म\.?\s*सं\.?|म\.?\s*नं\.?|म\.?\s*क्र\.?|गृह\s*सं\.?)[:ः\.\-\s]*/gi, '');
  s = s.replace(/(?:मकान|संख्या|मकरन|सपखजर|सपखसर|गृह|आयु|उम्र|लिंग|ward|house|no)+/gi, '');
  
  // Strip unnecessary punctuation but keep /, -, alphanumeric
  s = s.replace(/[%*~_!?;\'"‘’।॥«»°+={}\[\]()|<>^$&#@¥]+/g, ' ').trim();
  s = s.replace(/^[:\.\-\s]+|[:\.\-\s]+$/g, '');

  // Prefix allowed: e.g. क-12, ख/4, A-12
  const mPre = s.match(/([क-छA-Za-z])\s*[\/\-]?\s*(\d+(?:[\/\-]\d+)*)/);
  if (mPre) {
    return mPre[1].toUpperCase() + '-' + mPre[2];
  }

  // Digits + optional allowed suffix [क-छA-Za-z]
  const mNum = s.match(/(\d+(?:[\/\-]\d+)*)(?:\s*([\/\-]?\s*[क-छA-Za-z]))?/);
  if (mNum) {
    const dig = mNum[1];
    const suf = (mNum[2] || '').replace(/\s+/g, '').toUpperCase();
    return dig + suf;
  }

  // Preserve meaningful Hindi area/colony landmarks if present (e.g. बाईपास, माधव पैलेस)
  const landmark = s.replace(/[^\u0900-\u097F\s]/g, '').replace(/\s+/g, ' ').trim();
  const bannedLandmarks = ['मकान', 'संख्या', 'गृह', 'आयु', 'उम्र', 'लिंग', 'पुरुष', 'स्त्री', 'नाम', 'पिता', 'पति', 'माता', 'फोटो', 'उपलब्ध'];
  if (landmark.length >= 3 && !bannedLandmarks.some(b => landmark === b)) {
    return landmark;
  }

  return "-";
}

/**
 * Parse a voter block text into a structured voter object
 */
function parseVoterBlock(block) {
  const normBlock = normalizeDevanagariNumerals(block);
  const lines = normBlock.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let name = "";
  let relativeName = "";
  let relationType = "पिता";
  let houseNo = "";
  let age = null;
  let gender = "";
  let serialNo = null;

  // Extract Serial Number from top of block if present
  const mSerial = normBlock.match(/^(?:(?:क्रम|क्रमांक|क्र|sl|no)\.?\s*[:ः\-]?\s*)?(\d{1,4})\b/i);
  if (mSerial) {
    const sVal = parseInt(mSerial[1], 10);
    if (sVal > 0 && sVal <= 2500) serialNo = sVal;
  }

  for (const line of lines) {
    if (/क्षेत्र की संख्या|विधानसभा|निर्वाचक नामावली|कलेण्डर|वार्ड संख्या|भाग संख्या|मतदान केंद्र|अनुभाग/i.test(line)) {
      continue;
    }

    // Relative Name & Relation Type (including SEC Rajasthan variants: नपतर = पिता, पनत = पति, मरतर = माता)
    const mRel = line.match(/(?:(पिता|पति|माता|अन्य|नातेदार|नपतर|पनत|मरतर|पिपता|पित्ता|नाते)\s*(?:का|के|की|कर)?\s*(?:नाम|नाम्|नाभ|नरक|नरम|ताम)?)\s*[:ः\-\.]?\s*(.+)/i) ||
                 line.match(/(?:(पिता|पति|माता|अन्य|नातेदार|नपतर|पनत|मरतर|पिपता|पित्ता))\s*[:ः\-\.]\s*(.+)/i);
    if (mRel && !relativeName) {
      const rType = mRel[1];
      if (['नपतर', 'पिपता', 'पित्ता'].includes(rType)) relationType = 'पिता';
      else if (rType === 'पनत') relationType = 'पति';
      else if (rType === 'मरतर') relationType = 'माता';
      else relationType = (rType === 'नातेदार' || rType === 'नाते') ? 'अन्य' : rType;

      const rawRel = mRel[2].split(/\s*(?:मकान|मकरन|गृह|आयु|आजच|उम्र|लिंग|सलग|Sex)\b/i)[0];
      const relCand = cleanHindiText(rawRel);
      if (relCand && relCand.length >= 2 && !['है', 'हे', 'की', 'का', 'के'].includes(relCand)) {
        relativeName = relCand;
      }
      continue;
    }

    // Secondary relative name check (e.g. 'कर नरम: हीरालाल' without prefix)
    if (!relativeName && /(?:कर\s*नरम|का\s*नाम|कर\s*नरक)\s*[:ः\-]?\s*(.+)/i.test(line)) {
      const mRelOnly = line.match(/(?:कर\s*नरम|का\s*नाम|कर\s*नरक)\s*[:ः\-]?\s*(.+)/i);
      if (mRelOnly) {
        const rawRel = mRelOnly[1].split(/\s*(?:मकान|मकरन|गृह|आयु|आजच|उम्र|लिंग|सलग|Sex)\b/i)[0];
        const relCand = cleanHindiText(rawRel);
        if (relCand && relCand.length >= 2 && !['है', 'हे', 'की', 'का', 'के'].includes(relCand)) {
          relativeName = relCand;
          continue;
        }
      }
    }

    // Voter Name (supporting both standard 'नाम:' and SEC 'नरम:')
    if (!/(?:(?:पिता|पति|माता|अन्य|नातेदार|नपतर|पनत|मरतर)\s*(?:का|कर)?\s*(?:नाम|नरम)|मकान|मकरन|गृह|आयु|आजच|लिंग|सलग)/i.test(line)) {
      const mName = line.match(/(?:[\|\[\(\\\/]*\s*(?:मतदाता\s*(?:का)?\s*)?(?:नाम|नाम्|नाभ|नरम))\s*[:ः\-\.\s]\s*([^\n\r]+)/i);
      if (mName && !name) {
        let cand = mName[1];
        cand = cand.split(/\s*(?:(?:पिता|पति|माता|अन्य|नातेदार|नपतर|पनत|मरतर)\s*(?:का|कर)?\s*(?:नाम|नरम)|मकान|मकरन|गृह|आयु|आजच|उम्र|लिंग|सलग|Sex)\b/i)[0];
        if (!/क्षेत्र|संख्या|विधानसभा|निर्वाचक|नामावली|वार्ड/i.test(cand)) {
          const nameCand = cleanHindiText(cand);
          if (nameCand && nameCand.length >= 2 && !['है', 'हे', 'की', 'का'].includes(nameCand)) {
            name = nameCand;
          }
        }
      }
    }

    // House Number
    const mH = line.match(/(?:मकान\s*संख्या|गृह\s*संख्या)\s*[:ः\-]?\s*(.+)/i);
    if (mH && !houseNo) {
      const rawH = mH[1].split(/\s*(?:आयु|उम्र|लिंग|Sex)\b/i)[0];
      const hCand = cleanHouseNo(rawH);
      if (hCand) houseNo = hCand;
    }

    // Age
    const mA = line.match(/(?:आयु|आयू|आय|उम्र|age|वर्ष)\s*[:ः\-]?\s*(\d{1,3})/i);
    if (mA && age === null) {
      try {
        const aVal = parseInt(mA[1], 10);
        if (aVal >= 18 && aVal <= 125) age = aVal;
      } catch {}
    }

    // Gender
    const mG = line.match(/(?:लिंग|Sex|gender)\s*[:ः\-]?\s*([^\s\n\r]+)/i);
    if (mG && !gender) {
      const g = mG[1].toLowerCase();
      if (/पुरूष|पुरुष|पु|male|man|परुष/i.test(g)) gender = "पुरुष";
      else if (/स्त्री|महिला|eft|at|aft|ett|eff|fem|female/i.test(g)) gender = "स्त्री";
    }
  }

  // Fallback for name: first valid devanagari line
  if (!name) {
    for (const line of lines) {
      if (!/पिता|पति|माता|मकान|आयु|लिंग|क्षेत्र|संख्या|विधानसभा|वार्ड|SSB|RJ\/|GKV|DELETED|विलोपित/i.test(line)) {
        const devMatch = line.match(/[\u0900-\u097F]/g);
        if (devMatch && devMatch.length >= 3) {
          const cand = cleanHindiText(line);
          if (cand && cand.length >= 2 && !['है', 'हे'].includes(cand)) {
            name = cand;
            break;
          }
        }
      }
    }
  }

  // Intelligent Gender Inference:
  if (relationType === 'पति') {
    gender = 'स्त्री';
  } else if (name && ['देवी', 'कुमारी', 'बाई', 'बेगम', 'कंवर', 'श्रीमती', 'अनीता', 'सुनीता', 'पूजा', 'मंजू'].some(fem => name.includes(fem))) {
    gender = 'स्त्री';
  }
  if (!gender) gender = 'पुरुष';

  // Voter EPIC ID
  const epicMatch = normBlock.match(/(?:[A-Z]{3}[0-9]{7}|[A-Z]{2,4}[0-9]{6,8}|[A-Z]{2,3}\s*[\/\-]\s*\d{1,3}\s*[\/\-]\s*\d{1,3}\s*[\/\-]\s*\d{3,7})/i);

  // Check if voter is marked deleted
  const isDeleted = /DELETED|ELETED|विलोपित/i.test(normBlock);

  return {
    epic: epicMatch ? epicMatch[0].replace(/\s+/g, '').toUpperCase() : "",
    serialNo,
    nameHi: name,
    relativeNameHi: relativeName,
    relationType,
    houseNo,
    age,
    gender,
    status: isDeleted ? "Deleted" : "Active"
  };
}

/**
 * Perform local high-precision 3-column OCR on a given PDF file
 * 
 * @param {string} pdfPath - Path to the PDF file
 * @param {function} onProgress - Callback for reporting progress (0-100)
 * @returns {Promise<{ fullText: string, extractedVoters: Array }>}
 */
async function performLocalOCR(pdfPath, onProgress = () => {}) {
  let fullText = "";
  const extractedVoters = [];

  onProgress(10);
  console.log(`Starting high-resolution PDF rendering for OCR: ${pdfPath}`);
  
  // Render pages at 2.0x scale (optimal accuracy vs speed)
  const pngPages = await pdfToPng(pdfPath, {
    viewportScale: 2.0,
    disableFontFace: true,
    useSystemFonts: false,
  });

  const totalPages = pngPages.length;
  console.log(`Rendered ${totalPages} pages to images.`);
  onProgress(20);

  // Initialize Tesseract worker with Hindi + English models
  const worker = await Tesseract.createWorker('hin+eng');
  await worker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
  });

  onProgress(25);

  // Process each page
  for (let p = 0; p < totalPages; p++) {
    // In electoral rolls, first 2 pages are Cover / Map / Polling Station info pages
    if (p < 2 && totalPages > 2) {
      console.log(`Skipping cover/preface page ${p + 1} of ${totalPages}...`);
      continue;
    }

    console.log(`OCR processing page ${p + 1} of ${totalPages}...`);
    const imgBuf = pngPages[p].content;
    const width = pngPages[p].width;
    const height = pngPages[p].height;

    // Standard Electoral Roll Layout:
    // Header (Top 9%), Footer (Bottom 5%), Voter Card Grid (Middle 86%)
    const top = Math.floor(height * 0.09);
    const contentHeight = Math.floor(height * 0.86);

    // 3 Columns with generous bounding box coverage
    const colWidth = Math.floor(width * 0.34);
    const cols = [
      { left: Math.floor(width * 0.02), width: colWidth },
      { left: Math.floor(width * 0.33), width: colWidth },
      { left: Math.floor(width * 0.64), width: Math.floor(width * 0.35) }
    ];

    const columnVoterBoxes = [[], [], []];

    for (let c = 0; c < 3; c++) {
      try {
        const { data: { text: colText } } = await worker.recognize(imgBuf, {
          rectangle: {
            left: cols[c].left,
            top,
            width: cols[c].width,
            height: contentHeight
          }
        });

        fullText += `\n--- PAGE ${p + 1} COL ${c + 1} ---\n` + colText;

        // Split column text into voter cards using universal age/gender block boundary (including SEC: आजच = आयु, सलग = लिंग)
        const blocks = colText.split(/((?:(?:आयु|आयू|आय|jag|iag|ay|age|आजच|आज)[:ः\s]*\d+[\s\S]{0,15}?(?:लिंग|Sex|सलग)[:ः\s]*\S+|(?:लिंग|Sex|सलग)[:ः\s]*\S+))/i);
        for (let b = 0; b < blocks.length - 1; b += 2) {
          const fullBlock = blocks[b] + " " + blocks[b + 1];
          const parsed = parseVoterBlock(fullBlock);
          // Only add if card has an authentic voter name and valid voter details
          if (parsed.nameHi && parsed.nameHi !== 'मतदाता' && parsed.nameHi.length >= 2) {
            if (parsed.relativeNameHi || parsed.epic || parsed.age) {
              columnVoterBoxes[c].push(parsed);
            }
          }
        }
      } catch (colErr) {
        console.warn(`OCR error on page ${p + 1} col ${c + 1}:`, colErr.message);
      }
    }

    // Interleave columns in standard electoral roll reading order:
    // Row 1 (Col 1, Col 2, Col 3), Row 2 (Col 1, Col 2, Col 3)...
    const maxRows = Math.max(
      columnVoterBoxes[0].length,
      columnVoterBoxes[1].length,
      columnVoterBoxes[2].length
    );

    for (let r = 0; r < maxRows; r++) {
      for (let c = 0; c < 3; c++) {
        if (columnVoterBoxes[c][r]) {
          extractedVoters.push(columnVoterBoxes[c][r]);
        }
      }
    }

    // Progress updates from 25% to 85%
    const currentProgress = 25 + Math.floor(((p + 1) / totalPages) * 60);
    onProgress(currentProgress);
  }

  await worker.terminate();
  console.log(`OCR complete. Extracted ${extractedVoters.length} voter cards across ${totalPages} pages.`);
  onProgress(88);

  return { fullText, extractedVoters };
}

module.exports = {
  performLocalOCR,
  cleanHindiText,
  cleanHouseNo,
  parseVoterBlock
};
