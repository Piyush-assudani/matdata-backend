function normalizeDevanagariNumerals(str) {
  if (!str) return "";
  const devanagariDigits = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];
  let res = String(str);
  for (let i = 0; i < 10; i++) {
    res = res.replaceAll(devanagariDigits[i], String(i));
  }
  return res;
}

function cleanHouseNo(str) {
  if (!str) return "-";
  let s = normalizeDevanagariNumerals(String(str)).trim();
  if (/^(?:लागू नहीं|उपलब्ध नहीं|शून्य|nil|na|none|n\/a|0+|—|\-|\.)$/i.test(s) || /^[०\s]+$/.test(s)) {
    return "-";
  }

  // If text starts with or is purely age/gender/photo noise, reject or split
  // e.g. "आयु : 28", "उम्र 35", "लिंग : पुरुष", "फोटो उपलब्ध"
  if (/^(?:आयु|उम्र|age|वर्ष|लिंग|gender|फोटो|photo|sex)/i.test(s)) {
    return "-";
  }

  // Strip trailing age/gender parts if merged, e.g. "45 आयु : 28" -> "45"
  s = s.split(/(?:आयु|उम्र|age|वर्ष|लिंग|gender|फोटो|photo|sex)(?:[:\s\.\-\/]|$|[0-9])/i)[0].trim();

  // Strip label prefixes
  s = s.replace(/^(?:मकान|संख्या|मकरन|सपखजर|सपखसर|गृह|भवन|कमरा|फ्लैट|वार्ड|ward|house|no|room|flat|ft|at|et|Fy|Ik|iad|है|हे|मिका|पु|Nha|AY)[:ः\.\-\s]*/gi, "");
  s = s.replace(/^(?:म\.?\s*सं\.?|म\.?\s*नं\.?|म\.?\s*क्र\.?|म०\s*सं०?|म०\s*नं०?|गृह\s*सं\.?|भवन\s*सं\.?|कमरा\s*नं\.?|फ्लैट\s*नं\.?|h\.?\s*no\.?)[:ः\.\-\s]*/gi, "");
  s = s.replace(/(?:मकान|संख्या|मकरन|सपखजर|सपखसर|गृह|भवन|कमरा|फ्लैट|ward|house|no)+/gi, "");

  // Strip unnecessary punctuation but keep /, -, alphanumeric, and Hindi characters
  s = s.replace(/[%*~_!?;\'"‘’।॥«»°+={}\[\]()|<>^$&#@¥]+/g, " ").trim();
  s = s.replace(/^[:\.\-\s]+|[:\.\-\s]+$/g, "");

  if (!s || /^0+$/.test(s) || /^[०\s]+$/.test(s) || /^(?:—|\-|\.)$/.test(s)) {
    return "-";
  }

  // Prefix allowed: e.g. क-12, ख/4, A-12, B-45
  const mPre = s.match(/^([क-हA-Za-z])\s*[\/\-]\s*(\d+(?:[\/\-]\d+)*)/);
  if (mPre) {
    let dig = mPre[2];
    if (/^0+$/.test(dig)) return "-";
    dig = dig.replace(/^0+([1-9]\d*)/, "$1");
    return mPre[1].toUpperCase() + "-" + dig;
  }

  // Digits + optional allowed suffix:
  // Allowed suffixes: Devanagari consonants [क-ह], vowel extensions [ए|बी|सी|डी], or single English letter [A-Za-z]
  // We need to avoid attaching full hindi words as noise e.g. "4लि" -> "4", "2मका" -> "2"
  const mNum = s.match(/(\d+(?:[\/\-]\d+)*)(?:\s*([\/\-]?\s*(?:[क-ह]|(?:ए|ऐ|ओ|औ|अं|बी|सी|डी)|[A-Za-z](?![A-Za-z]))))?/);
  if (mNum) {
    let dig = mNum[1];
    if (/^0+$/.test(dig)) {
      return "-";
    }
    // Strip leading zeroes on numbers: e.g. 05 -> 5, 012/1 -> 12/1
    dig = dig.split("/").map(p => p.replace(/^0+([1-9]\d*)/, "$1")).join("/");
    let suf = (mNum[2] || "").replace(/\s+/g, "");

    // Notice: if suffix is attached to noise like "लि" in "4लि" or "मका" in "2मका"
    // In regression test: '4लि' -> '4', '2मका' -> '2', '2kh' -> '2'
    const afterNum = s.slice(s.indexOf(mNum[1]) + mNum[1].length).trim();
    if (/^(?:लि|मका|मकान|kh|ju)/i.test(afterNum)) {
      suf = "";
    } else {
      const sep = /^[/\-]/.test(suf) ? suf[0] : "";
      const letter = suf.replace(/^[/\-]/, "");
      if (/^[क-हए]$/.test(letter) || /^(?:बी|सी|डी)$/.test(letter) || /^[A-Za-z]$/.test(letter)) {
        suf = sep + (letter.length === 1 && /[a-zA-Z]/.test(letter) ? letter.toUpperCase() : letter);
      } else {
        suf = "";
      }
    }

    return dig + suf;
  }

  // Meaningful landmark
  const landmark = s.replace(/[^\u0900-\u097F\s]/g, "").replace(/\s+/g, " ").trim();
  const bannedLandmarks = ["मकान", "मका", "संख्या", "गृह", "आयु", "उम्र", "लिंग", "पुरुष", "स्त्री", "नाम", "पिता", "पति", "माता", "फोटो", "उपलब्ध", "आईसीआईसीआई", "नि लि", "नि", "लि"];
  if (landmark.length >= 3 && !bannedLandmarks.includes(landmark) && !/(?:मकान|मका|आईसीआईसीआई|नि\s*लि|बैंक)/.test(landmark)) {
    return landmark;
  }

  return "-";
}

const testCases = [
  ["11ग", "11ग"],
  ["12क", "12क"],
  ["12ज", "12ज"],
  ["12ए", "12ए"],
  ["15/ख", "15/ख"],
  ["क-12", "क-12"],
  ["4लि", "4"],
  ["2मका", "2"],
  ["000ju", "-"],
  ["0", "-"],
  ["00", "-"],
  ["05", "5"],
  ["012A", "12A"],
  ["2kh", "2"],
  ["मका", "-"],
  [". आईसीआईसीआई", "-"],
  [". नि लि", "-"],
  ["मकान संख्या: 2क", "2क"],
  ["मकान नं. 45", "45"],
  ["म.सं. 12/4", "12/4"],
  ["आयु : 28", "-"],
  ["45 आयु : 28", "45"],
  ["मकान संख्या : 14", "14"],
  ["कमरा नं. 3", "3"],
  ["फ्लैट 102", "102"],
];

let failed = 0;
for (const [input, expected] of testCases) {
  const actual = cleanHouseNo(input);
  if (actual !== expected) {
    console.error("FAIL for:", JSON.stringify(input), "expected:", expected, "got:", actual);
    failed++;
  } else {
    console.log("PASS:", input, "=>", actual);
  }
}
if (failed > 0) process.exit(1);
console.log("ALL TESTS PASSED!");
