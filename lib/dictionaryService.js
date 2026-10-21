const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const learnedJsonPath = path.join(dataDir, 'learned_dictionary.json');

// Base count of static dictionary glyphs
const BASE_KNOWN_GLYPHS = 305;
const BASE_KNOWN_WORDS = 180;

function readLearnedJson() {
  try {
    if (fs.existsSync(learnedJsonPath)) {
      const raw = fs.readFileSync(learnedJsonPath, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[DictionaryService] Could not read learned JSON:', err.message);
  }
  return { glyphs: {}, words: {}, total_glyphs: 0, total_words: 0, last_updated: null };
}

function writeLearnedJson(data) {
  try {
    fs.writeFileSync(learnedJsonPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.warn('[DictionaryService] Could not write learned JSON:', err.message);
  }
}

async function getDictionaryStats() {
  const jsonDict = readLearnedJson();
  let dbCount = 0;
  try {
    const { LearnedDictionary } = require('../models');
    if (LearnedDictionary) {
      dbCount = await LearnedDictionary.countDocuments();
    }
  } catch {
    // ignore
  }

  const learnedGlyphsCount = Object.keys(jsonDict.glyphs || {}).length;
  const learnedWordsCount = Object.keys(jsonDict.words || {}).length;
  const totalKnownGlyphs = BASE_KNOWN_GLYPHS + learnedGlyphsCount;
  const totalKnownWords = BASE_KNOWN_WORDS + learnedWordsCount;

  return {
    totalKnownGlyphs,
    totalKnownWords,
    learnedGlyphsCount: Math.max(learnedGlyphsCount, dbCount),
    learnedWordsCount,
    lastUpdated: jsonDict.last_updated || new Date().toISOString(),
  };
}

async function syncFromDiskToDb() {
  try {
    const jsonDict = readLearnedJson();
    const { LearnedDictionary } = require('../models');
    if (!LearnedDictionary) return;

    const ops = [];
    for (const [key, val] of Object.entries(jsonDict.glyphs || {})) {
      ops.push({
        updateOne: {
          filter: { key },
          update: {
            $set: {
              key,
              value: typeof val === 'object' ? val.val : val,
              type: 'glyph',
              sourcePdf: typeof val === 'object' ? (val.source || '') : '',
              createdAt: new Date(),
            },
          },
          upsert: true,
        },
      });
    }

    for (const [key, val] of Object.entries(jsonDict.words || {})) {
      ops.push({
        updateOne: {
          filter: { key },
          update: {
            $set: {
              key,
              value: typeof val === 'object' ? val.val : val,
              type: 'word',
              sourcePdf: typeof val === 'object' ? (val.source || '') : '',
              createdAt: new Date(),
            },
          },
          upsert: true,
        },
      });
    }

    if (ops.length > 0) {
      await LearnedDictionary.bulkWrite(ops, { ordered: false });
      console.log(`[DictionaryService] Synced ${ops.length} entries to MongoDB`);
    }
  } catch (err) {
    console.warn('[DictionaryService] syncFromDiskToDb error:', err.message);
  }
}

async function syncFromDbToDisk() {
  try {
    const { LearnedDictionary } = require('../models');
    if (!LearnedDictionary) return;

    const entries = await LearnedDictionary.find({}).lean();
    if (!entries || !entries.length) return;

    const current = readLearnedJson();
    const glyphs = current.glyphs || {};
    const words = current.words || {};

    for (const entry of entries) {
      if (entry.type === 'glyph') {
        glyphs[entry.key] = entry.value;
      } else {
        words[entry.key] = entry.value;
      }
    }

    writeLearnedJson({
      glyphs,
      words,
      total_glyphs: Object.keys(glyphs).length,
      total_words: Object.keys(words).length,
      last_updated: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[DictionaryService] syncFromDbToDisk error:', err.message);
  }
}

// Initial sync on startup
setTimeout(() => {
  void syncFromDiskToDb();
}, 2000);

module.exports = {
  getDictionaryStats,
  readLearnedJson,
  writeLearnedJson,
  syncFromDiskToDb,
  syncFromDbToDisk,
};
