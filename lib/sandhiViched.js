/**
 * Devanagari Sandhi Viched & Compound Word Splitter (Node.js engine)
 * Splits glued titles, suffixes, and surnames in voter names
 */

const COMPOUND_TITLES = [
  // Females
  'देवी', 'कंवर', 'बाई', 'कुमारी', 'बेगम', 'बानू', 'बानो', 'खातून',
  // Males
  'सिंह', 'प्रसाद', 'कुमार',
  // Community & Surnames
  'जैन', 'शर्मा', 'माली', 'मेघवाल', 'सुथार', 'जाट', 'गुर्जर',
  'सोलंकी', 'पंवार', 'राठौड़', 'चौधरी', 'मोहम्मद', 'अंसारी',
  'बिश्नोई', 'यादव', 'अहीर', 'दर्जी', 'सोनी', 'लोहार', 'घांची',
  'कुमावत', 'गोदारा', 'बेनीवाल', 'पूनिया', 'झा', 'मिश्रा', 'पाण्डेय'
];

const TITLE_PAT = new RegExp(
  `([\\u0900-\\u097F]{2,}?)(${COMPOUND_TITLES.join('|')})(?=[^\\u0900-\\u097F]|$)`,
  'g'
);

function sandhiViched(name) {
  if (!name || typeof name !== 'string') return '';
  let clean = name.normalize('NFC').trim();
  clean = clean.replace(TITLE_PAT, '$1 $2');
  return clean.replace(/\s+/g, ' ').trim();
}

module.exports = {
  sandhiViched,
  COMPOUND_TITLES
};
