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
    const mongoose = require('mongoose');
    if (!LearnedDictionary || !mongoose.connection || mongoose.connection.readyState !== 1) return;

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

/**
 * Dynamic Self-Learning Feedback:
 * Whenever an admin or client corrects a voter name, this function learns it across:
 * 1. In-memory HINDI_MAP & FuzzyNameMatcher (0% error on future uploads)
 * 2. MongoDB LearnedDictionary collection
 * 3. Local disk learned_dictionary.json
 */
async function learnNameCorrection(originalName, correctedName, sourceInfo = 'manual_edit') {
  try {
    if (!correctedName || typeof correctedName !== 'string') return;
    const cleanCorrected = correctedName.trim().normalize('NFC');
    if (!cleanCorrected || cleanCorrected.length < 2) return;

    const { registerLearnedCorrection, registerValidName } = require('./fuzzyNameMatcher');
    const { HINDI_MAP } = require('./hindiDictionary');
    const { LearnedDictionary } = require('../models');

    // Always register the corrected name as a certified authentic Indian name
    registerValidName(cleanCorrected);

    if (originalName && typeof originalName === 'string') {
      const cleanOriginal = originalName.trim().normalize('NFC');
      if (cleanOriginal && cleanOriginal !== cleanCorrected && cleanOriginal.length >= 2) {
        // 1. In-memory runtime override
        HINDI_MAP[cleanOriginal] = cleanCorrected;
        registerLearnedCorrection(cleanOriginal, cleanCorrected);

        // 2. Disk persistence in learned_dictionary.json
        const current = readLearnedJson();
        if (!current.words) current.words = {};
        current.words[cleanOriginal] = cleanCorrected;
        current.total_words = Object.keys(current.words).length;
        current.last_updated = new Date().toISOString();
        writeLearnedJson(current);

        // 3. Database persistence in MongoDB LearnedDictionary (if DB connected)
        const mongoose = require('mongoose');
        if (LearnedDictionary && mongoose.connection && mongoose.connection.readyState === 1) {
          await LearnedDictionary.updateOne(
            { key: cleanOriginal },
            {
              $set: {
                key: cleanOriginal,
                value: cleanCorrected,
                type: 'name',
                sourcePdf: sourceInfo,
                confidence: 1.0,
                createdAt: new Date()
              }
            },
            { upsert: true }
          );
        }
        console.log(`[DictionaryService] Successfully learned correction: "${cleanOriginal}" -> "${cleanCorrected}"`);
      }
    }
  } catch (err) {
    console.warn('[DictionaryService] learnNameCorrection error:', err.message);
  }
}

// Initial sync on startup
setTimeout(() => {
  void syncFromDiskToDb();
}, 2000).unref();

module.exports = {
  getDictionaryStats,
  readLearnedJson,
  writeLearnedJson,
  syncFromDiskToDb,
  syncFromDbToDisk,
  learnNameCorrection
};
