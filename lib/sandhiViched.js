/**
 * Devanagari Sandhi Viched & Compound Word Splitter (Node.js engine)
 * Splits glued titles, suffixes, and surnames in voter names
 */

const COMPOUND_TITLES = [
  // Females
  'देवी', 'कंवर', 'बाई', 'कुमारी', 'बेगम', 'बानू', 'बानो', 'खातून',
  // Males
  'सिंह', 'प्रसाद', 'कुमार', 'लाल', 'चन्द', 'चंद', 'राम', 'प्रकाश', 'भान', 'दत्त',
  // Community & Surnames
  'जैन', 'शर्मा', 'माली', 'मेघवाल', 'सुथार', 'जाट', 'गुर्जर',
  'सोलंकी', 'पंवार', 'राठौड़', 'चौधरी', 'मोहम्मद', 'अंसारी',
  'बिश्नोई', 'यादव', 'अहीर', 'दर्जी', 'सोनी', 'लोहार', 'घांची',
  'कुमावत', 'गोदारा', 'बेनीवाल', 'पूनिया', 'झा', 'मिश्रा', 'पाण्डेय',
  'अग्रवाल', 'खण्डेलवाल', 'वर्मा', 'गौतम', 'तिवारी', 'जोशी', 'व्यास',
  'दवे', 'भट्ट', 'पंडित', 'पटेल', 'राव', 'दीवान', 'राणा', 'शेखावत'
];

const TITLE_PAT = new RegExp(
  `([\\u0900-\\u097F]{2,}?)(${COMPOUND_TITLES.join('|')})(?=[^\\u0900-\\u097F]|$)`,
  'g'
);

function fixDevanagariMatras(text) {
  if (!text || typeof text !== 'string') return '';
  let str = text;
  // 1. Duplicate matras
  str = str.replace(/[\u093E]{2,}/g, '\u093E');
  str = str.replace(/[\u093F]{2,}/g, '\u093F');
  str = str.replace(/[\u0940]{2,}/g, '\u0940');
  str = str.replace(/[\u0941]{2,}/g, '\u0941');
  str = str.replace(/[\u0942]{2,}/g, '\u0942');
  str = str.replace(/[\u0947]{2,}/g, '\u0947');
  str = str.replace(/[\u0948]{2,}/g, '\u0948');
  str = str.replace(/[\u094B]{2,}/g, '\u094B');
  str = str.replace(/[\u094C]{2,}/g, '\u094C');
  str = str.replace(/[\u0902]{2,}/g, '\u0902');

  // 2. Inverted matra + anusvara
  str = str.replace(/(\u0902)([\u093E-\u094C])/g, '$2$1');

  // 3. Standalone virama at end of word
  str = str.replace(/\u094D(?=\s|$)/g, '');

  return str;
}

function sandhiViched(name) {
  if (!name || typeof name !== 'string') return '';
  let clean = name.normalize('NFC').trim();
  clean = fixDevanagariMatras(clean);
  clean = clean.replace(TITLE_PAT, '$1 $2');
  return clean.replace(/\s+/g, ' ').trim();
}

module.exports = {
  sandhiViched,
  COMPOUND_TITLES
};
