/**
 * Bulletproof Input Sanitization Middleware
 * Protects against:
 * 1. NoSQL Injection (strips keys starting with $ or containing .)
 * 2. Prototype Pollution (__proto__, constructor, prototype)
 * 3. Giant input payloads / ReDoS bombs (caps query string length)
 * 4. Null byte injection (\0)
 */

function sanitizeObject(obj, depth = 0) {
  if (depth > 10) return null; // Prevent deeply nested stack overflow
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, depth + 1));
  }

  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    // 1. Prototype pollution guard
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }

    // 2. NoSQL injection guard: disallow keys starting with $ or containing .
    if (key.startsWith('$') || key.includes('.')) {
      continue;
    }

    // 3. String value sanitization
    if (typeof val === 'string') {
      // Strip null bytes
      let cleanStr = val.replace(/\0/g, '');
      // In query parameters, cap string lengths to 255 characters to prevent ReDoS/memory exhaustion
      if (depth === 0 && cleanStr.length > 2000) {
        cleanStr = cleanStr.slice(0, 2000);
      }
      clean[key] = cleanStr;
    } else if (typeof val === 'object' && val !== null) {
      clean[key] = sanitizeObject(val, depth + 1);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

function sanitizeInput(req, res, next) {
  try {
    if (req.query && typeof req.query === 'object') {
      req.query = sanitizeObject(req.query);
    }
    if (req.params && typeof req.params === 'object') {
      req.params = sanitizeObject(req.params);
    }
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObject(req.body);
    }
    next();
  } catch (err) {
    console.warn('[Sanitizer] Malformed input rejected:', err.message);
    res.status(400).json({ message: 'अमान्य डेटा इनपुट (Malformed input detected).' });
  }
}

module.exports = { sanitizeInput, sanitizeObject };
