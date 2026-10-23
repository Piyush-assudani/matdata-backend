/**
 * Safe Regex Utilities for Antigravity / Matdata Portal
 * Prevents regex injection and syntax errors (e.g. searching with '+', '(', '[', '*', '?')
 */

function escapeRegex(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeRegex(value, flags = 'i') {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  try {
    return new RegExp(escapeRegex(trimmed), flags);
  } catch {
    return null;
  }
}

module.exports = { escapeRegex, safeRegex };
