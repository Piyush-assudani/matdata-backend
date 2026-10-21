// Heuristic mapping for corrupted ECI Rajasthan PDFs
const HINDI_MAP = {
  // Common Surnames / Titles
  "कचमरर": "कुमार",
  "दलरल": "देवी",
  "मरलशरल": "माहेश्वरी",
  "तरपनरजर": "तापड़िया",
  "तरपडलजर": "तापड़िया",
  "मलरतर": "मीना",
  "शमरा": "शर्मा",
  "जजन": "जैन",
  "सनह": "सिंह",
  "कवर": "कंवर",
  "बरई": "बाई",
  "दसरन": "दास",
  "चयरदरस": "छोड़दास",
  
  // Common Names
  "रनसररज": "रामस्वरूप",
  "रणचयरदरस": "रणछोड़दास",
  "मनलषर": "मनीषा",
  "रसररज": "रामस्वरूप",
  "नरमरनशच": "नर्मदा",
  "लरलनर": "ललिता",
  "तनरल": "तनीषा",
  "पनकज": "पंकज",
  "कजलरश": "कैलाश",
  "ओमपकरश": "ओमप्रकाश",
  "सनगलतर": "संगीता",
  "अशयक": "अशोक",
  "चनदर": "चंदा",
  "मनजप": "मनदीप",
  "आजचषल": "आयुषी",
  "सयरनलरलन": "सोहनलाल",
  "मलठरलरल": "मीठालाल",
  "जरनशकर": "जानकी",
  "कयशनलजर": "कौशल्या",
  "गचरर": "गौरी",
  "नजनर": "नीना",
  "ररम": "राम",
  "शरमर": "श्याम",
  "मयहन": "मोहन",
  "सरलर": "सरला",
  "कमलर": "कमला",
  "सचनलर": "सुनीला"
};

function fixCorruptedHindi(text) {
  if (!text) return text;
  
  let fixedText = text;
  
  // Replace whole words based on dictionary
  const words = fixedText.split(' ');
  const correctedWords = words.map(word => {
    return HINDI_MAP[word] || word;
  });
  
  fixedText = correctedWords.join(' ');
  
  // Apply partial fixes for common patterns
  fixedText = fixedText.replace(/रनसररज/g, "रामस्वरूप");
  fixedText = fixedText.replace(/रणचयरदरस/g, "रणछोड़दास");
  fixedText = fixedText.replace(/मनलषर/g, "मनीषा");
  fixedText = fixedText.replace(/रसररज/g, "रामस्वरूप");
  fixedText = fixedText.replace(/तरपडलजर/g, "तापड़िया");
  fixedText = fixedText.replace(/तरपनरजर/g, "तापड़िया");
  fixedText = fixedText.replace(/नरमरनशच/g, "नर्मदा");
  fixedText = fixedText.replace(/लरलनर/g, "ललिता");
  fixedText = fixedText.replace(/तनरल/g, "तनीषा");
  fixedText = fixedText.replace(/कचमरर/g, "कुमार");
  fixedText = fixedText.replace(/दलरल/g, "देवी");
  fixedText = fixedText.replace(/मरलशरल/g, "माहेश्वरी");
  fixedText = fixedText.replace(/पकरश/g, "प्रकाश");
  
  return fixedText.trim();
}

module.exports = { fixCorruptedHindi, HINDI_MAP };
