/**
 * Safe Regex Utilities for Chunav Ranniti (चुनाव रणनीति)
 * Prevents regex injection, ReDoS attacks, syntax errors (e.g. '+', '(', '[', '*', '?'),
 * and memory exhaustion from oversized inputs.
 */

function sanitizeInput(value, maxLength = 150) {
  if (value === null || value === undefined) return '';
  // Convert to string, strip null bytes and invisible control characters, trim, and cap length
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

module.exports = { escapeRegex, safeRegex, sanitizeInput };
