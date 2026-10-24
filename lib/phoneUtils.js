/**
 * Phone Sanitization & Validation Utility for Chunav Ranniti
 * Handles: Devanagari numbers (०-९), prefixes (+91, 0, 91), spaces, dashes,
 * multiple phone numbers ("9876543210 / 9876543211"), and trailing notes.
 */

const DEVANAGARI_DIGITS = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'
};

function normalizeDevanagariDigits(input) {
  if (!input) return '';
  return String(input).replace(/[०-९]/g, (d) => DEVANAGARI_DIGITS[d] || d);
}

function sanitizeIndianPhone(input) {
  if (!input) return { valid: false, phone: '', formatted: '' };

  // 1. Convert any Devanagari digits to 0-9
  let clean = normalizeDevanagariDigits(input).trim();

  // 2. If multiple numbers separated by slash or comma, take the first one
  if (clean.includes('/') || clean.includes(',')) {
    clean = clean.split(/[/,]/)[0].trim();
  }

  // 3. Remove all non-digits except a leading +
  clean = clean.replace(/[^\d+]/g, '');

  // 4. Remove leading +91, 0091, 91 (if length is 12), or leading 0
  if (clean.startsWith('+91')) {
    clean = clean.substring(3);
  } else if (clean.startsWith('0091')) {
    clean = clean.substring(4);
  } else if (clean.startsWith('0') && clean.length === 11) {
    clean = clean.substring(1);
  } else if (clean.startsWith('91') && clean.length === 12) {
    clean = clean.substring(2);
  }

  // 5. Clean should now be exactly 10 digits starting with 6, 7, 8, or 9
  const is10DigitValid = /^[6-9]\d{9}$/.test(clean);

  if (!is10DigitValid) {
    return {
      valid: false,
      phone: clean,
      formatted: clean,
      error: 'अमान्य मोबाइल नंबर। कृपया 10 अंकों का वैध भारतीय मोबाइल नंबर दर्ज करें।'
    };
  }

  return {
    valid: true,
    phone: clean,              // 10 digits e.g. "9876543210"
    international: `91${clean}`, // E.164 e.g. "919876543210"
    formatted: `+91 ${clean.slice(0, 5)} ${clean.slice(5)}`
  };
}

module.exports = { sanitizeIndianPhone, normalizeDevanagariDigits };
