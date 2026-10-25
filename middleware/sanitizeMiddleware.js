/**
 * Bulletproof Input Sanitization Middleware
 * Protects against:
 * 1. NoSQL Injection (strips keys starting with $ or containing .)
 * 2. Prototype Pollution (__proto__, constructor, prototype)
 * 3. Giant input payloads / ReDoS bombs (caps query string length)
 * 4. Null byte injection (\0)
 */

function sanitizeObject(obj, isQuery = false, depth = 0) {
  if (depth > 10) return null; // Prevent deeply nested stack overflow
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, isQuery, depth + 1));
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
      if (isQuery) {
        // In query parameters, cap string lengths to 500 characters to prevent ReDoS/memory exhaustion
        if (cleanStr.length > 500) {
          cleanStr = cleanStr.slice(0, 500);
        }
      } else {
        // In body, allow dataUrl / base64 image strings (e.g. voter slips) up to 20MB, but cap regular text at 15,000 chars
        if (cleanStr.startsWith('data:image/') || cleanStr.startsWith('data:application/')) {
          if (cleanStr.length > 20 * 1024 * 1024) {
            cleanStr = cleanStr.slice(0, 20 * 1024 * 1024);
          }
        } else if (cleanStr.length > 15000) {
          cleanStr = cleanStr.slice(0, 15000);
        }
      }
      clean[key] = cleanStr;
    } else if (typeof val === 'object' && val !== null) {
      clean[key] = sanitizeObject(val, isQuery, depth + 1);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

function sanitizeInput(req, res, next) {
  try {
    if (req.query && typeof req.query === 'object') {
      req.query = sanitizeObject(req.query, true);
    }
    if (req.params && typeof req.params === 'object') {
      req.params = sanitizeObject(req.params, true);
    }
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObject(req.body, false);
    }
    next();
  } catch (err) {
    console.warn('[Sanitizer] Malformed input rejected:', err.message);
    res.status(400).json({ message: 'अमान्य डेटा इनपुट (Malformed input detected).' });
  }
}

module.exports = { sanitizeInput, sanitizeObject };
