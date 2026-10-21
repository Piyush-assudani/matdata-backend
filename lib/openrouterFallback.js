const https = require('https');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const CANDIDATE_MODELS = [
  'openrouter/free',
  'liquid/lfm-2.5-2.6b:free',
  'google/gemma-4-26b-a4b-it:free'
];

/**
 * Checks if a voter record has missing or broken critical data
 * ONLY triggers when father/husband name or voter name is missing
 */
function needsAiRepair(record) {
  if (!record) return true;
  const name = String(record.nameHi || record.name || '').trim();
  const relName = String(record.relativeNameHi || record.relativeName || '').trim();

  if (!name || name.length < 2) return true;
  if (!relName || relName.length < 2 || ['-', '—', 'nil', 'na'].includes(relName)) return true;

  return false;
}

/**
 * Call OpenRouter with candidate fallback models
 */
async function callOpenRouter(prompt, timeoutMs = 12000) {
  if (!OPENROUTER_API_KEY) return null;

  return new Promise((resolve) => {
    const payload = JSON.stringify({
      models: CANDIDATE_MODELS,
      messages: [
        {
          role: 'system',
          content: 'You are an expert Indian Electoral Roll (मतदाता सूची) text parser. Extract structured voter data in Hindi Devanagari. Output VALID JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.1
    });

    const req = https.request({
      hostname: 'openrouter.ai',
      port: 443,
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://matdataportal.app',
        'X-Title': 'Matdata Portal AI Voter Extractor'
      },
      timeout: timeoutMs
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const content = parsed.choices?.[0]?.message?.content || null;
          resolve(content);
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Extract JSON object from raw response text
 */
function extractJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text.trim());
  } catch {}
  const m = text.match(/(\{[\s\S]*\})/);
  if (m) {
    try {
      return JSON.parse(m[1]);
    } catch {}
  }
  return null;
}

/**
 * Repair a single voter card if father or voter name is missing
 */
async function repairVoterCardJs(rawText, currentRecord) {
  if (!needsAiRepair(currentRecord) || !OPENROUTER_API_KEY) {
    return currentRecord;
  }

  const prompt = `Extract voter details from this raw Indian electoral roll card text.\nRaw Text:\n"""${rawText.trim()}"""\n\nOutput strictly as JSON:\n{\n  "name": "मतदाता का नाम",\n  "relativeName": "पिता या पति का नाम (बिना पिता/पति शब्द के)",\n  "relationType": "पिता" | "पति" | "माता",\n  "houseNo": "मकान सं (digits only, or -)",\n  "age": 30,\n  "gender": "पुरुष" | "स्त्री"\n}`;

  try {
    const resp = await callOpenRouter(prompt);
    const data = extractJson(resp);
    if (!data) return currentRecord;

    const { cleanHouseNo } = require('./ocrService');
    const name = String(data.name || '').trim();
    let relName = String(data.relativeName || '').trim();
    relName = relName.replace(/^(?:पिता|पति|माता|वालिद|आत्मज|सुपुत्र|पत्नी|सुपुत्री|नातेदार)[:\s\-]*/, '').trim();

    if ((!currentRecord.nameHi || currentRecord.nameHi.length < 2) && name.length >= 2) {
      currentRecord.nameHi = name;
    }
    if ((!currentRecord.relativeNameHi || currentRecord.relativeNameHi.length < 2) && relName.length >= 2) {
      currentRecord.relativeNameHi = relName;
    }
    if (['पिता', 'पति', 'माता'].includes(data.relationType)) {
      currentRecord.relationType = data.relationType;
    }
    if ((!currentRecord.houseNo || currentRecord.houseNo === '-') && data.houseNo && data.houseNo !== '-') {
      currentRecord.houseNo = cleanHouseNo(String(data.houseNo));
    }
    if ((!currentRecord.age || currentRecord.age < 18) && Number.isInteger(data.age) && data.age >= 18 && data.age <= 125) {
      currentRecord.age = data.age;
    }
    if (['पुरुष', 'स्त्री'].includes(data.gender)) {
      currentRecord.gender = data.gender;
    }
  } catch (err) {
    // Non-blocking fallback
  }

  return currentRecord;
}

module.exports = {
  needsAiRepair,
  repairVoterCardJs
};
