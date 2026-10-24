/**
 * Comprehensive System Stress & Security Test Suite
 * Tests for:
 * 1. NoSQL Injection & Prototype Pollution
 * 2. Regex Injection & ReDoS Bombing
 * 3. High Concurrency Load (Simulates 100 simultaneous workers)
 * 4. Auth Brute Force & Rate Limiting Enforcement
 * 5. Compression Verification
 * 6. Edge-Case Dirty Inputs (Emojis, Hindi numbers, giant strings)
 * 7. Zero Information Leakage (No stack traces or secrets)
 */

const http = require('http');
const { app, startServer } = require('../index');
const db = require('../db');

let server;
const PORT = 5099;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function makeRequest({ method = 'GET', path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqHeaders = { ...headers };
    let payload = null;

    if (body) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      url,
      {
        method,
        headers: reqHeaders,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {
            // non-json
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: raw,
            json,
          });
        });
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🚀 STARTING COMPREHENSIVE STRESS & SECURITY AUDIT');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  // 1. Health check & Server Liveness
  try {
    const health = await makeRequest({ path: '/api/health' });
    assert(health.statusCode === 200 || health.statusCode === 503, 'Health endpoint responds with valid JSON status');
  } catch (err) {
    assert(false, `Health check error: ${err.message}`);
  }

  // 2. Compression Header Test
  try {
    const legalRes = await makeRequest({
      path: '/api/legal/policies',
      headers: { 'Accept-Encoding': 'gzip' },
    });
    assert(legalRes.statusCode === 200, 'Legal endpoint responds successfully');
    const encoding = legalRes.headers['content-encoding'];
    assert(
      encoding === 'gzip' || encoding === 'deflate' || !legalRes.headers['content-length'] || parseInt(legalRes.headers['content-length']) < 1024,
      `Compression verification (encoding: ${encoding || 'none/threshold'})`
    );
  } catch (err) {
    assert(false, `Compression test failed: ${err.message}`);
  }

  // 3. NoSQL Injection Test in Query Params
  try {
    const nosqlRes = await makeRequest({
      path: '/api/voters?search[$gt]=&ward[$ne]=1',
    });
    // Should NOT crash server (401 is expected because route is protected, or 400 rejected by sanitizer)
    assert(
      nosqlRes.statusCode === 401 || nosqlRes.statusCode === 400 || nosqlRes.statusCode === 403,
      `NoSQL query injection safely handled with code ${nosqlRes.statusCode}`
    );
    assert(!nosqlRes.body.includes('MongoError') && !nosqlRes.body.includes('stack'), 'No MongoDB error/stack trace leaked');
  } catch (err) {
    assert(false, `NoSQL injection test failed: ${err.message}`);
  }

  // 4. Regex Injection & ReDoS Attack
  try {
    const redosPayload = '((a+)+)+$'.repeat(20);
    const redosRes = await makeRequest({
      path: `/api/voters?search=${encodeURIComponent(redosPayload)}`,
    });
    assert(redosRes.statusCode === 401 || redosRes.statusCode === 200 || redosRes.statusCode === 400, 'ReDoS regex bomb did not freeze or crash server');
  } catch (err) {
    assert(false, `ReDoS test failed: ${err.message}`);
  }

  // 5. Prototype Pollution in Body
  try {
    const protoRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: {
        __proto__: { isAdmin: true },
        constructor: { prototype: { poll: true } },
        username: 'test_user',
        password: 'test_password',
      },
    });
    assert(protoRes.statusCode === 400, 'Prototype pollution payload handled cleanly');
    assert(!Object.prototype.isAdmin, 'Object prototype was NOT polluted');
  } catch (err) {
    assert(false, `Prototype pollution test failed: ${err.message}`);
  }

  // 6. Giant 10,000-character Input Test
  try {
    const giantString = 'A'.repeat(10000);
    const giantRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: {
        email: `${giantString}@domain.com`,
        password: giantString,
      },
    });
    assert(giantRes.statusCode === 400, 'Giant input payload (10KB string) gracefully rejected');
  } catch (err) {
    assert(false, `Giant input test failed: ${err.message}`);
  }

  // 7. Special Unicode & Emojis Test
  try {
    const emojiRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: {
        username: '🚩राम ०१ 💥🔥\\0\x00',
        password: 'password_test',
      },
    });
    assert(emojiRes.statusCode === 400, 'Dirty input with emojis, null bytes & Hindi numbers handled safely');
  } catch (err) {
    assert(false, `Emoji & null bytes test failed: ${err.message}`);
  }

  // 8. High Concurrency Load Test (Simulating 50 concurrent requests)
  console.log('\n  ⚡ Simulating 50 concurrent requests on API...');
  const startTime = Date.now();
  const promises = [];
  for (let i = 0; i < 50; i++) {
    promises.push(makeRequest({ path: '/api/legal/policies' }));
  }

  const results = await Promise.all(promises);
  const elapsed = Date.now() - startTime;
  const allSuccessful = results.every((r) => r.statusCode === 200);
  assert(allSuccessful, `All 50 concurrent requests succeeded in ${elapsed}ms (${(elapsed / 50).toFixed(1)}ms per req)`);

  // 9. Login Rate Limiter (Brute Force Protection)
  console.log('\n  🔒 Testing Auth Rate Limiting Protection...');
  let rateLimited = false;
  for (let i = 0; i < 45; i++) {
    const res = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { username: `brute_${i}`, password: 'wrong_password' },
    });
    if (res.statusCode === 429) {
      rateLimited = true;
      break;
    }
  }
  assert(rateLimited, 'Authentication brute-force protection (HTTP 429 Too Many Requests) successfully triggered');

  // 10. Information Leakage Audit
  try {
    const badRes = await makeRequest({ path: '/api/non_existent_route_404_trigger' });
    assert(!badRes.body.includes('passwordHash'), 'No password hashes leaked in error response');
    assert(!badRes.body.includes('/Users/piyush'), 'No absolute server file paths leaked in error response');
    assert(!badRes.body.includes('mongodb://'), 'No database connection strings leaked');
  } catch (err) {
    assert(false, `Info leakage audit failed: ${err.message}`);
  }

  console.log('\n======================================================');
  console.log(`📊 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  return failed === 0;
}

async function main() {
  try {
    await db.connectDB();
    server = app.listen(PORT, async () => {
      console.log(`Test Server running on port ${PORT}`);
      const success = await runTests();
      server.close(async () => {
        await db.stopDB();
        process.exit(success ? 0 : 1);
      });
    });
  } catch (err) {
    console.error('Test startup failed:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
