const https = require('https');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];

/**
 * Checks if a voter record has missing or broken critical data
 */
/**
 * Checks if a voter record has missing, noisy, or broken critical data
 */
function needsAiRepair(record) {
  if (!record) return true;
  const name = String(record.nameHi || record.name || '').trim();
  const relName = String(record.relativeNameHi || record.relativeName || '').trim();
  const house = String(record.houseNo || '').trim();

  // Reject administrative words mistakenly saved as voter names
  const adminWords = ['ओसियाँ', 'विधानसभा', 'निर्वाचक', 'नामावली', 'ग्रामपंचायत', 'पंचायत', 'समिति', 'राजस्थान', 'आयोग', 'कलेण्डर', 'अनुभाग'];
  if (adminWords.some(w => name.includes(w)) || adminWords.some(w => relName.includes(w))) return true;

  if (!name || name.length < 2 || name === 'मतदाता') return true;
  if (!relName || relName.length < 2 || ['-', '—', 'nil', 'na', 'null'].includes(relName.toLowerCase())) return true;

  // Detect OCR noise, symbols, numbers, Latin letters, or stray punctuation in names
  if (/[0-9|«»<>\\/_~`!@#$%^&*()_+=\[\]{}A-Za-z“”….,;]/.test(name + relName)) return true;

  // Detect label bleed
  if (['का नाम', 'कर नरम', 'नपतर', 'पिता', 'पति', 'माता', 'नरम'].some(k => name.includes(k))) return true;
  if (['का नाम', 'कर नरम', 'नपतर', 'नरम'].some(k => relName.includes(k))) return true;

  // Corrupted or noisy house numbers
  if (house && (house.includes('आईसल') || house === '०००' || house === '000' || house === '0' || /[|«»~`!@#$%^&*()_+=\[\]{}]/.test(house))) {
    return true;
  }

  return false;
}

let groqDisabledUntil = 0;

function isGroqAvailable() {
  if (!GROQ_API_KEY) return false;
  return Date.now() >= groqDisabledUntil;
}

function tripGroqCircuitBreaker(reason, durationMs = 180000) {
  groqDisabledUntil = Date.now() + durationMs;
  console.warn(`⚠️ [GroqFallback] Circuit breaker tripped (${reason}). AI repair paused for ${durationMs / 1000}s. PDF upload continues seamlessly using native engine.`);
}

/**
 * Call Groq API with candidate model fallback and automatic rate-limit circuit breaker
 */
async function callGroq(prompt, timeoutMs = 12000) {
  if (!isGroqAvailable()) return null;

  for (const model of GROQ_MODELS) {
    if (!isGroqAvailable()) return null;
    try {
      const res = await new Promise((resolve, reject) => {
        const payload = JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: 'You are an expert Indian Electoral Roll (मतदाता सूची) text auditor and Hindi linguist. Output strictly VALID JSON only. No markdown formatting.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.1
        });

        const req = https.request({
          hostname: 'api.groq.com',
          path: '/openai/v1/chat/completions',
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json',
            'User-Agent': 'MatdataPortalEngine/2.0'
          },
          timeout: timeoutMs
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsed = JSON.parse(body);
                const content = parsed.choices?.[0]?.message?.content || null;
                resolve(content);
              } catch (e) {
                reject(e);
              }
            } else {
              if (res.statusCode === 429) {
                tripGroqCircuitBreaker('HTTP 429 - Rate limit reached', 180000); // 3 min pause
              } else if (res.statusCode === 402) {
                tripGroqCircuitBreaker('HTTP 402 - Quota exhausted', 600000); // 10 min pause
              }
              reject(new Error(`Groq HTTP ${res.statusCode}: ${body}`));
            }
          });
        });

        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Groq timeout'));
        });

        req.write(payload);
        req.end();
      });

      if (res) return res;
    } catch (err) {
      if (!isGroqAvailable()) {
        // If circuit breaker tripped, break model fallback loop immediately
        break;
      }
      continue;
    }
  }

  return null;
}

function extractJson(text) {
  if (!text) return null;
  const clean = text.replace(/```(?:json)?/g, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch {}
  const mArr = clean.match(/(\[[\s\S]*\])/);
  if (mArr) {
    try {
      return JSON.parse(mArr[1]);
    } catch {}
  }
  const mObj = clean.match(/(\{[\s\S]*\})/);
  if (mObj) {
    try {
      return JSON.parse(mObj[1]);
    } catch {}
  }
  return null;
}

/**
 * Repairs a single voter record using Groq
 */
async function repairVoterCardGroq(cardRawText, currentRecord) {
  if (!needsAiRepair(currentRecord)) return currentRecord;

  const prompt = `Extract clean Hindi voter details from this text card:
Card text: "${cardRawText}"
Current extracted: ${JSON.stringify(currentRecord)}

Note:
- In Rajasthan SEC rolls: 'र' may represent 'ा' (aa matra)
- Do NOT use administrative names like 'ओसियाँ', 'विधानसभा', 'वार्ड' as person names.
- Output JSON format:
{
  "name": "मतदाता का शुद्ध हिंदी नाम",
  "relativeName": "पिता/पति का शुद्ध हिंदी नाम",
  "relationType": "पिता" | "पति" | "माता",
  "houseNo": "मकान सं (संख्या केवल, जैसे 1, 2)",
  "age": 30,
  "gender": "पुरुष" | "स्त्री"
}`;

  const res = await callGroq(prompt, 6000);
  const data = extractJson(res);
  if (!data) return currentRecord;

  const adminWords = ['ओसियाँ', 'विधानसभा', 'निर्वाचक', 'नामावली', 'ग्रामपंचायत', 'पंचायत', 'समिति', 'राजस्थान'];
  const name = String(data.name || '').trim();
  const relName = String(data.relativeName || '').trim().replace(/^(?:पिता|पति|माता|वालिद|आत्मज|सुपुत्र|पत्नी)[:\s\-]*/, '');
  const relType = String(data.relationType || '').trim();
  const house = String(data.houseNo || '').trim().replace(/['"]/g, '');
  const age = Number(data.age);
  const gender = String(data.gender || '').trim();

  if (name && name.length >= 2 && !adminWords.some(w => name.includes(w))) {
    currentRecord.name = name;
    currentRecord.nameHi = name;
    if (currentRecord.status === 'Unreadable') {
      currentRecord.status = 'Active';
    }
  }

  if (relName && relName.length >= 2 && !adminWords.some(w => relName.includes(w))) {
    currentRecord.relativeName = relName;
    currentRecord.relativeNameHi = relName;
  }

  if (['पिता', 'पति', 'माता'].includes(relType)) {
    currentRecord.relationType = relType;
  }

  if (house && !['0', '-', '०००'].includes(house)) {
    currentRecord.houseNo = house;
  }

  if (age >= 18 && age <= 125) {
    currentRecord.age = age;
  }

  if (['पुरुष', 'स्त्री'].includes(gender)) {
    currentRecord.gender = gender;
  } else if (currentRecord.relationType === 'पति') {
    currentRecord.gender = 'स्त्री';
  }

  return currentRecord;
}

/**
 * Scans the entire voter list, identifies any suspicious or unverified records,
 * and uses Groq AI batch auditing to verify and fix them before database insertion.
 */
async function reverifyVotersListGroq(voterList, onProgress) {
  if (!Array.isArray(voterList) || voterList.length === 0) return voterList;
  if (!GROQ_API_KEY) return voterList;

  const candidatesToVerify = [];
  for (let i = 0; i < voterList.length; i++) {
    if (needsAiRepair(voterList[i])) {
      candidatesToVerify.push(i);
    }
  }

  console.log(`[reverifyVotersListGroq] Total records: ${voterList.length}, identified for AI reverification: ${candidatesToVerify.length}`);

  if (candidatesToVerify.length === 0) {
    if (onProgress) onProgress(100, "सभी रिकॉर्ड्स पूर्व-सत्यापित और सही पाए गए।");
    return voterList;
  }

  const BATCH_SIZE = 15;
  let processed = 0;

  for (let i = 0; i < candidatesToVerify.length; i += BATCH_SIZE) {
    if (!isGroqAvailable()) {
      console.warn(`[reverifyVotersListGroq] Groq limit reached or quota exhausted. Skipping remaining ${candidatesToVerify.length - processed} AI repairs; continuing PDF upload safely with native engine.`);
      if (onProgress) {
        onProgress(100, `मूल इंजन द्वारा सभी ${voterList.length} मतदाता सुरक्षित रूप से निकाले गए (AI कोटा सीमा)`);
      }
      break;
    }

    const chunkIndices = candidatesToVerify.slice(i, i + BATCH_SIZE);
    const chunkItems = chunkIndices.map(idx => {
      const v = voterList[idx];
      return {
        _idx: idx,
        serialNo: v.serialNo,
        epic: v.epic,
        nameHi: v.nameHi,
        relativeNameHi: v.relativeNameHi,
        relationType: v.relationType,
        houseNo: v.houseNo,
        age: v.age,
        gender: v.gender
      };
    });

    const batchPrompt = `You are a master Indian Electoral Roll (मतदाता सूची) data auditor and Hindi linguist.
Audit and clean the following voter records extracted from an electoral roll:
1. Fix any OCR noise, symbols, punctuation, or stray numbers in voter and relative names (e.g. "जवरी ७)" -> "जवरी", "बाइचुल७)" -> "बाबूलाल", "गीता.... रु 9" -> "गीता", "हितेश्‌ कु”" -> "हितेश कुमार", "शशेव लाल" -> "शिव लाल", "हुन्ना राम" -> "पन्ना राम", "खाबुलाल" -> "बाबूलाल").
2. Fix corrupted house numbers (e.g. "आईसलआईसलआई" -> "ICICI बैंक के पास", "०००" or "0" -> "").
3. Ensure relationType is 'पिता', 'पति', or 'माता'. If voter is female with husband name, relationType must be 'पति' and gender must be 'स्त्री'.
4. Ensure valid age (18-125) and gender ('पुरुष' / 'स्त्री').
5. Preserve the exact '_idx' integer in each object so records map back correctly.

INPUT VOTERS:
${JSON.stringify(chunkItems, null, 2)}

Return STRICT JSON ARRAY only of the audited objects with '_idx', 'nameHi', 'relativeNameHi', 'relationType', 'houseNo', 'age', 'gender':`;

    try {
      const responseText = await callGroq(batchPrompt, 15000);
      if (!isGroqAvailable()) {
        console.warn(`[reverifyVotersListGroq] Groq limit tripped during batch call. Continuing upload with native engine.`);
        break;
      }
      const parsedArray = extractJson(responseText);

      if (Array.isArray(parsedArray) && parsedArray.length > 0) {
        for (const item of parsedArray) {
          const origIdx = item._idx !== undefined ? item._idx : chunkIndices.find(ci => voterList[ci].serialNo === item.serialNo);
          if (origIdx !== undefined && voterList[origIdx]) {
            const v = voterList[origIdx];
            if (item.nameHi && item.nameHi.length >= 2 && !item.nameHi.includes('मतदाता')) {
              v.nameHi = String(item.nameHi).trim();
              if (v.status === 'Unreadable') {
                v.status = 'Active';
              }
            }
            if (item.relativeNameHi && item.relativeNameHi.length >= 2) {
              v.relativeNameHi = String(item.relativeNameHi).trim();
            }
            if (['पिता', 'पति', 'माता', 'अन्य'].includes(item.relationType)) {
              v.relationType = item.relationType;
            }
            if (item.houseNo !== undefined && item.houseNo !== null) {
              const h = String(item.houseNo).trim();
              if (h && !['0', '०००', '-'].includes(h)) v.houseNo = h;
            }
            if (item.age && item.age >= 18 && item.age <= 125) {
              v.age = Number(item.age);
            }
            if (['पुरुष', 'स्त्री'].includes(item.gender)) {
              v.gender = item.gender;
            } else if (v.relationType === 'पति') {
              v.gender = 'स्त्री';
            }
          }
        }
      } else {
        if (!isGroqAvailable()) {
          break;
        }
        // Fallback: repair individually
        await Promise.all(chunkIndices.map(async (idx) => {
          try {
            const item = voterList[idx];
            const rawContext = `Serial: ${item.serialNo}, Name: ${item.nameHi}, Relative: ${item.relativeNameHi}, House: ${item.houseNo}, Age: ${item.age}, Gender: ${item.gender}`;
            await repairVoterCardGroq(rawContext, item);
          } catch {}
        }));
      }
    } catch (batchErr) {
      if (!isGroqAvailable()) {
        console.warn(`[reverifyVotersListGroq] Circuit breaker tripped on error. Continuing upload safely.`);
        break;
      }
      console.warn(`[reverifyVotersListGroq] Batch error, falling back to individual repair:`, batchErr.message);
      await Promise.all(chunkIndices.map(async (idx) => {
        try {
          const item = voterList[idx];
          const rawContext = `Serial: ${item.serialNo}, Name: ${item.nameHi}, Relative: ${item.relativeNameHi}, House: ${item.houseNo}, Age: ${item.age}, Gender: ${item.gender}`;
          await repairVoterCardGroq(rawContext, item);
        } catch {}
      }));
    }

    processed += chunkIndices.length;
    const pct = Math.round((processed / candidatesToVerify.length) * 100);
    if (onProgress) {
      onProgress(pct, `Groq AI सत्यापन: ${processed}/${candidatesToVerify.length} संदिग्ध रिकॉर्ड्स शुद्ध किए गए...`);
    }
  }

  return voterList;
}

module.exports = {
  callGroq,
  needsAiRepair,
  repairVoterCardGroq,
  reverifyVotersListGroq
};

