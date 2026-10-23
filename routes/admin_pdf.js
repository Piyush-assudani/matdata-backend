const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cron = require('node-cron');
const { Voter } = require('../models');
const { fixCorruptedHindi } = require('../lib/hindiDictionary');
const { safeRegex } = require('../lib/regexUtils');
const { verifyToken, isAdmin } = require('../middleware/authMiddleware');

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

const uploadJobs = new Map();

// Task 4: STRICT AUTOMATED CLEANUP (2-Hour Deletion)
cron.schedule('0 * * * *', () => {
  console.log('Running PDF cleanup cron job...');
  
  // Cleanup uploadJobs map (older than 2 hours)
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  for (const [id, job] of uploadJobs.entries()) {
    if (new Date(job.uploadedAt) < twoHoursAgo) {
      uploadJobs.delete(id);
    }
  }

  fs.readdir(uploadDir, (err, files) => {
    if (err) return console.error('Cleanup error:', err);
    files.forEach(file => {
      if (file.endsWith('.pdf')) {
        const filePath = path.join(uploadDir, file);
        fs.stat(filePath, (err, stats) => {
          if (!err) {
            const now = new Date().getTime();
            // Exactly 2 hours TTL
            const endTime = new Date(stats.birthtime).getTime() + (2 * 60 * 60 * 1000);
            if (now > endTime) {
              fs.unlink(filePath, err => {
                if (!err) console.log(`Deleted expired PDF: ${file}`);
              });
            }
          }
        });
      }
    });
  });
});

// GET /jobs - to fetch recent upload jobs (SuperAdmin Only)
router.get('/jobs', verifyToken, isAdmin, (req, res) => {
  const orgId = req.query.organizationId;
  
  // Deduplicate identical duplicate jobs in memory (same file, same org, within 20s)
  const seenJobKeys = new Set();
  for (const [id, job] of uploadJobs.entries()) {
    const timeBucket = Math.floor(new Date(job.uploadedAt).getTime() / 20000);
    const key = `${job.organizationId}_${job.filename}_${job.wardNo || ''}_${timeBucket}`;
    if (seenJobKeys.has(key)) {
      uploadJobs.delete(id);
    } else {
      seenJobKeys.add(key);
    }
  }

  let jobs = Array.from(uploadJobs.values());
  if (orgId) {
    jobs = jobs.filter(j => j.organizationId === orgId);
  }
  jobs.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  res.json(jobs);
});

// DELETE /jobs/:id - remove single job from history (SuperAdmin Only)
router.delete('/jobs/:id', verifyToken, isAdmin, (req, res) => {
  const { id } = req.params;
  if (uploadJobs.has(id)) {
    uploadJobs.delete(id);
    return res.json({ success: true, message: 'जॉब हटा दी गई।' });
  }
  res.status(404).json({ error: 'Job not found' });
});

// DELETE /jobs - clear upload jobs (SuperAdmin Only)
router.delete('/jobs', verifyToken, isAdmin, (req, res) => {
  uploadJobs.clear();
  res.json({ success: true, message: 'Upload history cleared.' });
});

// GET /download-excel/:id - Download generated Excel file for a PDF job
router.get('/download-excel/:id', verifyToken, isAdmin, (req, res) => {
  const job = uploadJobs.get(req.params.id);
  if (!job || !job.excelPath || !fs.existsSync(job.excelPath)) {
    return res.status(404).json({ error: 'Excel फाइल उपलब्ध नहीं है या अभी प्रोसेस हो रही है।' });
  }
  const downloadName = job.excelFilename || 'voter_list.xlsx';
  res.download(job.excelPath, downloadName);
});

// GET /dictionary-stats - Get real-time status of the self-learning dictionary
router.get('/dictionary-stats', verifyToken, isAdmin, async (req, res) => {
  try {
    const { getDictionaryStats } = require('../lib/dictionaryService');
    const stats = await getDictionaryStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch dictionary stats' });
  }
});

// Task 3: Admin PDF Upload & Voter ID Extraction (SuperAdmin Only) - Supports Single & Multiple PDFs
router.post('/upload', verifyToken, isAdmin, (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'फाइल का आकार 100MB से बड़ा है। कृपया 100MB से छोटी PDF फाइल अपलोड करें।' });
      }
      return res.status(400).json({ error: `फ़ाइल अपलोड त्रुटि: ${err.message}` });
    } else if (err) {
      return res.status(500).json({ error: `सर्वर अपलोड त्रुटि: ${err.message}` });
    }
    next();
  });
}, async (req, res) => {
  try {
    const rawFiles = req.files && req.files.length ? req.files : (req.file ? [req.file] : []);
    const seenFiles = new Set();
    const pdfFiles = [];
    for (const f of rawFiles) {
      const isPdf = f.originalname.toLowerCase().endsWith('.pdf') || f.mimetype === 'application/pdf';
      if (isPdf) {
        const key = `${f.originalname.toLowerCase().trim()}_${f.size}`;
        if (!seenFiles.has(key)) {
          seenFiles.add(key);
          pdfFiles.push(f);
        } else {
          try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch {}
        }
      }
    }
    if (!pdfFiles.length) {
      return res.status(400).json({ error: 'कृपया कम से कम एक वैध PDF फाइल (.pdf) चुनें।' });
    }
    
    const organizationId = req.body.organizationId || "org_default";
    const uploadedBy = (req.body.uploadedBy || "").trim();
    const useOcr = req.body.useOcr === 'true' || req.body.useOcr === 'on' || req.body.useOcr === true;
    const withPhotos = req.body.withPhotos === 'true' || req.body.withPhotos === 'on' || req.body.withPhotos === true;
    const globalWard = (req.body.wardNo || "").trim();
    const globalPanchayat = (req.body.panchayat || "").trim();
    const globalBooth = (req.body.boothNo || "").trim();
    const globalDesc = (req.body.listDescription || "").trim();

    // Parse sequential/comma-separated ward list (e.g. "17, 18" or "17 , 18")
    let wardList = [];
    if (globalWard) {
      if (globalWard.includes(',')) {
        wardList = globalWard.split(',').map(w => w.trim()).filter(Boolean);
      } else if (globalWard.includes(' ') && globalWard.split(/\s+/).every(w => /^\d+$/.test(w) || w.startsWith('वार्ड'))) {
        wardList = globalWard.split(/\s+/).map(w => w.trim()).filter(Boolean);
      } else {
        wardList = [globalWard];
      }
    }

    let boothList = [];
    if (globalBooth) {
      if (globalBooth.includes(',')) {
        boothList = globalBooth.split(',').map(b => b.trim()).filter(Boolean);
      } else {
        boothList = [globalBooth];
      }
    }

    const createdJobs = [];
    const { Organization } = require('../models');
    const { Worker } = require('worker_threads');

    for (let fileIdx = 0; fileIdx < pdfFiles.length; fileIdx++) {
      const file = pdfFiles[fileIdx];
      const filePath = file.path;

      // Sequential ward assignment for multi-file upload
      let wardNo = '';
      if (wardList.length > fileIdx) {
        wardNo = wardList[fileIdx];
      } else if (wardList.length === 1 && pdfFiles.length === 1) {
        wardNo = wardList[0];
      } else {
        // Auto-detect ward from filename if not specified in sequential list
        const wardMatch = file.originalname.match(/(?:Ward|वार्ड|ward)[\s_\-]*0*(\d+)/i);
        if (wardMatch) {
          wardNo = wardMatch[1];
        } else if (wardList.length === 1) {
          wardNo = wardList[0];
        }
      }

      let boothNo = '';
      if (boothList.length > fileIdx) {
        boothNo = boothList[fileIdx];
      } else if (boothList.length === 1 && pdfFiles.length === 1) {
        boothNo = boothList[0];
      } else {
        const boothMatch = file.originalname.match(/(?:Booth|बूथ|Part|भाग)[\s_\-]*0*(\d+)/i);
        if (boothMatch) {
          boothNo = boothMatch[1];
        } else if (boothList.length === 1) {
          boothNo = boothList[0];
        }
      }

      // Auto-register ward & panchayat in Organization if new
      if (organizationId) {
        try {
          const updateObj = {};
          if (wardNo) {
            updateObj.wards = wardNo;
            updateObj.allowedWards = wardNo;
          }
          if (globalPanchayat) {
            updateObj.panchayats = globalPanchayat;
            updateObj.allowedPanchayats = globalPanchayat;
          }
          if (Organization && (wardNo || globalPanchayat)) {
            await Organization.updateOne(
              { _id: organizationId },
              { $addToSet: updateObj }
            );
          }
        } catch (orgErr) {
          console.warn('Could not update organization wards/panchayats:', orgErr.message);
        }
      }

      const jobId = crypto.randomUUID();
      const listDescription = globalDesc || (pdfFiles.length > 1 ? file.originalname : (wardNo ? `वार्ड ${wardNo} मतदाता सूची` : ''));
      // Auto-detect withPhotos if filename contains WithPhoto/with_photo
      const fileWithPhotos = withPhotos || /with[_\-\s]?photo/i.test(file.originalname);

      uploadJobs.set(jobId, {
        id: jobId,
        filename: file.originalname,
        organizationId: organizationId,
        wardNo: wardNo,
        panchayat: globalPanchayat,
        boothNo: boothNo,
        uploadedBy: uploadedBy,
        withPhotos: fileWithPhotos,
        listDescription: listDescription,
        status: 'processing',
        progress: 5,
        stageMessage: fileWithPhotos ? '📄 PDF प्राप्त हुई (फोटो मोड चालू)...' : '📄 PDF फ़ाइल प्राप्त हुई, प्रक्रिया शुरू...',
        extractedCount: 0,
        uploadedAt: new Date().toISOString()
      });

      createdJobs.push({ jobId, filename: file.originalname, wardNo, panchayat: globalPanchayat, withPhotos: fileWithPhotos });

      // Start worker thread
      const worker = new Worker(path.join(__dirname, '../workers/pdfWorker.js'), {
        workerData: {
          filePath,
          organizationId,
          useOcr,
          withPhotos: fileWithPhotos,
          jobId,
          wardNo,
          boothNo,
          panchayat: globalPanchayat,
          uploadedBy
        }
      });

      worker.on('message', async (msg) => {
        if (msg.type === 'progress') {
          uploadJobs.set(jobId, { 
            ...uploadJobs.get(jobId), 
            progress: typeof msg.data === 'number' ? msg.data : (msg.progress || 0),
            stageMessage: msg.stage || uploadJobs.get(jobId)?.stageMessage || 'प्रोसेसिंग चालू है...'
          });
        } else if (msg.type === 'done') {
          const operations = msg.data;
          const epicsCount = msg.epicsCount;
          
          try {
            if (operations && operations.length > 0) {
              // Preserve existing photos if current upload did not extract photos
              try {
                const missingPhotoOps = operations.filter(op => !op.updateOne?.update?.$set?.photoUrl);
                if (missingPhotoOps.length > 0) {
                  const existingVoters = await Voter.find({
                    organizationId,
                    photoUrl: { $exists: true, $ne: '' }
                  }, { serialNo: 1, epic: 1, photoUrl: 1, wardNo: 1 }).lean();

                  const photoMapBySerial = new Map();
                  const photoMapByEpic = new Map();
                  for (const ev of existingVoters) {
                    if (ev.serialNo) photoMapBySerial.set(`${ev.wardNo}_${ev.serialNo}`, ev.photoUrl);
                    if (ev.epic) photoMapByEpic.set(ev.epic, ev.photoUrl);
                  }

                  for (const op of missingPhotoOps) {
                    const f = op.updateOne?.filter;
                    const s = op.updateOne?.update?.$set;
                    if (f && s) {
                      const existingUrl = photoMapBySerial.get(`${f.wardNo}_${f.serialNo}`) || (s.epic ? photoMapByEpic.get(s.epic) : null);
                      if (existingUrl) {
                        s.photoUrl = existingUrl;
                      }
                    }
                  }
                }
              } catch (photoPreserveErr) {
                console.warn('[admin_pdf] Photo preservation check error:', photoPreserveErr.message);
              }

              const CHUNK_SIZE = 2500;
              let processed = 0;
              for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
                const chunk = operations.slice(i, i + CHUNK_SIZE);
                await Voter.bulkWrite(chunk, { ordered: false });
                processed += chunk.length;
                const dbProgress = Math.floor((processed / operations.length) * 11);
                uploadJobs.set(jobId, { 
                  ...uploadJobs.get(jobId), 
                  progress: 88 + dbProgress,
                  stageMessage: `💾 सत्यापित डेटा डेटाबेस में सुरक्षित हो रहा है (${processed}/${operations.length})...`
                });
              }

              // 🚀 AUTOMATIC WARD ROLL SYNCHRONIZATION:
              // Remove any stale serials from previous uploads that are no longer in this roll.
              try {
                const activeSerialsByWard = new Map();
                for (const op of operations) {
                  const f = op.updateOne?.filter;
                  if (f && f.wardNo && f.serialNo) {
                    const key = `${f.wardNo}_${f.partNo || ''}`;
                    if (!activeSerialsByWard.has(key)) {
                      activeSerialsByWard.set(key, { wardNo: f.wardNo, partNo: f.partNo, serials: new Set() });
                    }
                    activeSerialsByWard.get(key).serials.add(f.serialNo);
                  }
                }
                for (const { wardNo: wNo, partNo: pNo, serials } of activeSerialsByWard.values()) {
                  const cleanupFilter = {
                    organizationId: organizationId,
                    wardNo: wNo,
                    serialNo: { $nin: Array.from(serials) }
                  };
                  if (pNo) cleanupFilter.partNo = pNo;
                  try {
                    const staleWithPhotos = await Voter.find(cleanupFilter, { photoUrl: 1 }).lean();
                    const urls = staleWithPhotos.map(v => v.photoUrl).filter(Boolean);
                    if (urls.length > 0) {
                      const { deleteVoterPhotos } = require('../lib/cloudinaryService');
                      deleteVoterPhotos(urls).catch(e => console.warn('[admin_pdf] Cloudinary stale photo cleanup error:', e.message));
                    }
                  } catch (photoErr) {
                    console.warn('[admin_pdf] Cloudinary photo check failed:', photoErr.message);
                  }
                  const delRes = await Voter.deleteMany(cleanupFilter);
                  if (delRes.deletedCount > 0) {
                    console.log(`[admin_pdf] Synchronized Ward ${wNo}: Removed ${delRes.deletedCount} stale records.`);
                  }
                }
              } catch (cleanErr) {
                console.warn('[admin_pdf] Ward synchronization cleanup warning:', cleanErr.message);
              }
            }

            // Sync any newly learned dictionary entries to MongoDB
            try {
              const { syncFromDiskToDb } = require('../lib/dictionaryService');
              await syncFromDiskToDb();
            } catch {}
            
            uploadJobs.set(jobId, {
              ...uploadJobs.get(jobId),
              status: 'completed',
              progress: 100,
              stageMessage: '✅ सत्यापन व डिक्शनरी विस्तार पूर्ण! सभी मतदाता रिकॉर्ड्स सुरक्षित हो गए हैं।',
              extractedCount: epicsCount,
              excelPath: msg.excelPath,
              excelFilename: msg.excelFilename,
              hasExcel: Boolean(msg.excelPath)
            });

            // Invalidate cache immediately so UI shows exact live voter counts
            try {
              const cache = require('../lib/cache');
              if (cache && cache.flushAll) {
                cache.flushAll();
              }
            } catch {}

            console.log(`Background PDF processing complete for ${filePath}. Extracted ${epicsCount} voters. Excel: ${msg.excelFilename}`);
          } catch (dbError) {
            uploadJobs.set(jobId, { 
              ...uploadJobs.get(jobId), 
              status: 'failed', 
              progress: 0, 
              errorMessage: `डेटाबेस में सुरक्षित करने में त्रुटि: ${dbError.message}` 
            });
            console.error(`Database write failed for ${filePath}:`, dbError);
          }
        } else if (msg.type === 'error') {
          uploadJobs.set(jobId, { 
            ...uploadJobs.get(jobId), 
            status: 'failed', 
            progress: 0, 
            errorMessage: msg.data || 'PDF पार्सिंग में समस्या आई।' 
          });
          console.error(`Worker PDF processing failed for ${filePath}:`, msg.data);
        }
      });

      worker.on('error', (err) => {
        uploadJobs.set(jobId, { 
          ...uploadJobs.get(jobId), 
          status: 'failed', 
          progress: 0, 
          errorMessage: err.message || 'Worker thread execution error' 
        });
        console.error(`Worker error for ${filePath}:`, err);
      });

      worker.on('exit', (code) => {
        if (code !== 0 && uploadJobs.get(jobId)?.status !== 'completed') {
          uploadJobs.set(jobId, { 
            ...uploadJobs.get(jobId), 
            status: 'failed', 
            progress: 0, 
            errorMessage: `Worker process exited with code ${code}` 
          });
        }
      });
    }

    res.json({
      message: `${pdfFiles.length} PDF फाइल(ें) प्राप्त हुईं और बैकग्राउंड में प्रोसेस हो रही हैं।`,
      backgroundProcessing: true,
      jobId: createdJobs[0]?.jobId,
      jobs: createdJobs,
      totalFiles: pdfFiles.length
    });

  } catch (error) {
    console.error('PDF processing error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /unreadable-deleted - List voters with Deleted or Unreadable status for side panel review
router.get('/unreadable-deleted', verifyToken, isAdmin, async (req, res) => {
  try {
    const orgId = req.query.organizationId || req.user.organizationId || 'org_demo_election_2025';
    const { ward, panchayat, status } = req.query;

    const baseQuery = { organizationId: orgId };
    if (ward) {
      baseQuery.wardNo = String(ward).trim();
    }
    if (panchayat) {
      const panchayatRegex = safeRegex(panchayat);
      if (panchayatRegex) baseQuery.panchayat = panchayatRegex;
    }

    let statusCondition = { $in: ['Deleted', 'Unreadable'] };
    if (status === 'Deleted' || status === 'Unreadable') {
      statusCondition = status;
    }

    const voters = await Voter.find({ ...baseQuery, status: statusCondition })
      .sort({ serialNo: 1, wardNo: 1 })
      .lean();

    const deleted = voters.filter(v => v.status === 'Deleted');
    const unreadable = voters.filter(v => v.status === 'Unreadable');

    res.json({
      success: true,
      total: voters.length,
      deletedCount: deleted.length,
      unreadableCount: unreadable.length,
      deleted,
      unreadable
    });
  } catch (err) {
    console.error('Failed to fetch unreadable/deleted voters:', err);
    res.status(500).json({ error: 'Failed to fetch unreadable/deleted voters' });
  }
});

// POST /recover-voter - Recover deleted voter(s) and add back to active list
router.post('/recover-voter', verifyToken, isAdmin, async (req, res) => {
  try {
    const { voterId, voterIds } = req.body;
    const ids = voterIds && Array.isArray(voterIds) ? voterIds : (voterId ? [voterId] : []);
    if (!ids.length) {
      return res.status(400).json({ error: 'कृपया कम से कम एक वोटर आईडी दें।' });
    }

    const result = await Voter.updateMany(
      { _id: { $in: ids } },
      { 
        $set: { 
          status: 'Active',
          voted: false
        } 
      }
    );

    // Clean up any "(विलोपित)" suffix from nameHi if present
    const voters = await Voter.find({ _id: { $in: ids } });
    for (const v of voters) {
      if (v.nameHi && v.nameHi.includes('विलोपित')) {
        v.nameHi = v.nameHi.replace(/[\(\[\{]?विलोपित[\)\]\}]?/g, '').trim();
        await v.save();
      }
    }

    // Invalidate cache
    try {
      const cache = require('../lib/cache');
      if (cache && cache.flushAll) cache.flushAll();
    } catch {}

    res.json({
      success: true,
      message: `${result.modifiedCount} मतदाता सफलतापूर्वक पुनः सक्रिय (Recover) किए गए और मुख्य सूची में जोड़े गए।`,
      recoveredCount: result.modifiedCount
    });
  } catch (err) {
    console.error('Failed to recover voter:', err);
    res.status(500).json({ error: 'मतदाता को पुनः सक्रिय करने में समस्या आई।' });
  }
});

// PUT /update-unreadable-voter - Edit unreadable voter details and activate into active list
router.put('/update-unreadable-voter', verifyToken, isAdmin, async (req, res) => {
  try {
    const { voterId, nameHi, nameEn, relativeNameHi, relationType, houseNo, age, gender, epic, serialNo, wardNo, panchayat, caste } = req.body;
    if (!voterId) {
      return res.status(400).json({ error: 'voterId आवश्यक है।' });
    }

    const voter = await Voter.findById(voterId);
    if (!voter) {
      return res.status(404).json({ error: 'मतदाता रिकॉर्ड नहीं मिला।' });
    }

    if (nameHi) voter.nameHi = String(nameHi).trim();
    if (nameEn) voter.nameEn = String(nameEn).trim();
    if (relativeNameHi !== undefined) voter.relativeNameHi = String(relativeNameHi).trim();
    if (relationType) voter.relationType = String(relationType).trim();
    if (houseNo !== undefined) voter.houseNo = String(houseNo).trim();
    if (age !== undefined) voter.age = Number(age) || voter.age;
    if (gender) voter.gender = String(gender).trim();
    if (epic) voter.epic = String(epic).trim();
    if (serialNo !== undefined) voter.serialNo = Number(serialNo) || voter.serialNo;
    if (wardNo) voter.wardNo = String(wardNo).trim();
    if (panchayat !== undefined) voter.panchayat = String(panchayat).trim();
    if (caste) voter.caste = String(caste).trim();

    voter.status = 'Active'; // Activate!
    voter.notes = 'अपठनीय कार्ड को सफलतापूर्वक संपादित करके सक्रिय किया गया।';

    await voter.save();

    // Invalidate cache
    try {
      const cache = require('../lib/cache');
      if (cache && cache.flushAll) cache.flushAll();
    } catch {}

    res.json({
      success: true,
      message: 'मतदाता का विवरण सफलतापूर्वक सही किया गया और मुख्य सूची में जोड़ दिया गया।',
      voter
    });
  } catch (err) {
    console.error('Failed to update unreadable voter:', err);
    res.status(500).json({ error: 'मतदाता को संपादित करने में समस्या आई।' });
  }
});

router.uploadJobs = uploadJobs;
module.exports = router;
