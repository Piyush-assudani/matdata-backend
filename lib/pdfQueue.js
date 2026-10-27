const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const { Voter } = require('../models');

// Optional Redis Connection
let Redis = null;
try {
  Redis = require('ioredis');
} catch (e) {
  // ioredis not available or error
}

const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_URI;
let redisClient = null;
let isRedisReady = false;

if (REDIS_URL && Redis) {
  try {
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 500, 2000)),
      connectTimeout: 3000,
      lazyConnect: true,
    });

    redisClient.on('connect', () => {
      console.log('⚡ [PdfQueue] Redis connected for persistent job queue!');
      isRedisReady = true;
    });

    redisClient.on('ready', () => {
      isRedisReady = true;
    });

    redisClient.on('error', (err) => {
      if (isRedisReady) {
        console.warn('⚠️ [PdfQueue] Redis connection lost, switching to in-memory queue:', err.message);
      }
      isRedisReady = false;
    });

    redisClient.on('close', () => {
      isRedisReady = false;
    });

    redisClient.connect().catch((err) => {
      console.warn('⚠️ [PdfQueue] Redis initial connection failed, using in-memory queue:', err.message);
      isRedisReady = false;
    });
  } catch (err) {
    console.warn('⚠️ [PdfQueue] Could not initialize Redis client, using in-memory queue:', err.message);
  }
} else {
  console.log('ℹ️ [PdfQueue] No REDIS_URL configured; running in-memory high-speed FIFO sequential queue.');
}

class PdfQueueManager {
  constructor() {
    this.inMemoryJobs = new Map();
    this.inMemoryQueue = [];
    this.isProcessing = false;
    this.activeJobId = null;
    this.activeWorker = null;
    this.watchdogTimer = null;
    this.WATCHDOG_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes max per PDF
  }

  /**
   * Save or update job in L1 (Memory) and L2 (Redis if connected)
   */
  async saveJob(job) {
    if (!job || !job.id) return;
    this.inMemoryJobs.set(job.id, { ...job });

    if (isRedisReady && redisClient) {
      try {
        await redisClient.hset('chunav:pdf_jobs', job.id, JSON.stringify(job));
      } catch (e) {
        // Redis sync warning non-blocking
      }
    }
  }

  /**
   * Fetch single job
   */
  getJob(jobId) {
    return this.inMemoryJobs.get(jobId) || null;
  }

  /**
   * Fetch all jobs, optionally filtered by organizationId
   */
  getJobs(organizationId = null) {
    // Deduplicate identical duplicate jobs in memory (same file, same org, within 20s)
    const seenJobKeys = new Set();
    for (const [id, job] of this.inMemoryJobs.entries()) {
      const timeBucket = Math.floor(new Date(job.uploadedAt).getTime() / 20000);
      const key = `${job.organizationId}_${job.filename}_${job.wardNo || ''}_${timeBucket}`;
      if (seenJobKeys.has(key)) {
        this.inMemoryJobs.delete(id);
      } else {
        seenJobKeys.add(key);
      }
    }

    let jobs = Array.from(this.inMemoryJobs.values());
    if (organizationId) {
      jobs = jobs.filter(j => j.organizationId === organizationId);
    }
    jobs.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
    return jobs;
  }

  /**
   * Delete single job
   */
  async deleteJob(jobId) {
    const deleted = this.inMemoryJobs.delete(jobId);
    this.inMemoryQueue = this.inMemoryQueue.filter(id => id !== jobId);

    if (isRedisReady && redisClient) {
      try {
        await redisClient.hdel('chunav:pdf_jobs', jobId);
        await redisClient.lrem('chunav:pdf_queue', 0, jobId);
      } catch (e) {}
    }
    return deleted;
  }

  /**
   * Clear all jobs
   */
  async clearJobs() {
    this.inMemoryJobs.clear();
    this.inMemoryQueue = [];

    if (isRedisReady && redisClient) {
      try {
        await redisClient.del('chunav:pdf_jobs');
        await redisClient.del('chunav:pdf_queue');
      } catch (e) {}
    }
  }

  /**
   * Add a new PDF upload job to the queue.
   * If idle, starts processing "hatho-hath" (immediately).
   * If busy, marks as queued and processes sequentially.
   */
  async enqueueJob(jobData) {
    const job = {
      id: jobData.id,
      filename: jobData.filename,
      filePath: jobData.filePath,
      organizationId: jobData.organizationId || 'org_default',
      wardNo: jobData.wardNo || '',
      panchayat: jobData.panchayat || '',
      boothNo: jobData.boothNo || '',
      uploadedBy: jobData.uploadedBy || '',
      withPhotos: jobData.withPhotos !== false,
      useOcr: Boolean(jobData.useOcr),
      listDescription: jobData.listDescription || '',
      status: 'queued',
      progress: 0,
      stageMessage: 'कतार (Queue) में प्रतीक्षारत... पिछली फाइल पूरी होते ही तुरंत शुरू होगी',
      extractedCount: 0,
      uploadedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      excelPath: null,
      excelFilename: null,
      hasExcel: false,
      errorMessage: null,
    };

    await this.saveJob(job);
    this.inMemoryQueue.push(job.id);

    if (isRedisReady && redisClient) {
      try {
        await redisClient.rpush('chunav:pdf_queue', job.id);
      } catch (e) {}
    }

    console.log(`[PdfQueue] Job ${job.id} enqueued (${job.filename}). Queue length: ${this.inMemoryQueue.length}`);

    // Trigger sequential runner immediately ("hatho-hath")
    setImmediate(() => this.processNext());
    return job;
  }

  /**
   * Sequential worker executor - processes 1 PDF at a time (Concurrency = 1)
   */
  async processNext() {
    if (this.isProcessing) {
      return; // Already actively processing a job
    }

    let nextJobId = null;

    if (isRedisReady && redisClient) {
      try {
        nextJobId = await redisClient.lpop('chunav:pdf_queue');
      } catch (e) {}
    }

    if (!nextJobId) {
      nextJobId = this.inMemoryQueue.shift() || null;
    }

    if (!nextJobId) {
      return; // Queue is empty!
    }

    const job = this.getJob(nextJobId);
    if (!job) {
      // Job was deleted while in queue, pick next
      return setImmediate(() => this.processNext());
    }

    // Mark as active
    this.isProcessing = true;
    this.activeJobId = job.id;
    job.status = 'processing';
    job.startedAt = new Date().toISOString();
    job.progress = 5;
    job.stageMessage = job.withPhotos 
      ? '📄 PDF प्राप्त हुई (फोटो मोड चालू)... प्रक्रिया शुरू...' 
      : '📄 PDF फ़ाइल प्राप्त हुई, प्रक्रिया शुरू...';
    await this.saveJob(job);

    console.log(`[PdfQueue] 🚀 Starting sequential execution for Job ${job.id}: ${job.filename} (Ward: ${job.wardNo || 'Auto'})`);

    // Safety Watchdog: Prevent stuck processing if worker thread crashes or hangs
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      console.error(`[PdfQueue] ⚠️ Watchdog timeout (15m exceeded) for Job ${job.id}! Terminating worker to prevent hang.`);
      if (this.activeWorker) {
        try { this.activeWorker.terminate(); } catch {}
      }
      this.finishJob(job.id, {
        status: 'failed',
        errorMessage: 'प्रोसेसिंग टाइमआउट: PDF पार्सिंग में 15 मिनट से अधिक समय लगा।'
      });
    }, this.WATCHDOG_TIMEOUT_MS);

    try {
      const worker = new Worker(path.join(__dirname, '../workers/pdfWorker.js'), {
        workerData: {
          filePath: job.filePath,
          organizationId: job.organizationId,
          useOcr: job.useOcr,
          withPhotos: job.withPhotos,
          jobId: job.id,
          wardNo: job.wardNo,
          boothNo: job.boothNo,
          panchayat: job.panchayat,
          uploadedBy: job.uploadedBy
        }
      });
      this.activeWorker = worker;

      worker.on('message', async (msg) => {
        if (msg.type === 'progress') {
          const currentJob = this.getJob(job.id);
          if (currentJob && currentJob.status === 'processing') {
            currentJob.progress = typeof msg.data === 'number' ? msg.data : (msg.progress || currentJob.progress);
            currentJob.stageMessage = msg.stage || currentJob.stageMessage;
            await this.saveJob(currentJob);
          }
        } else if (msg.type === 'done') {
          await this.handleJobCompletion(job, msg);
        } else if (msg.type === 'error') {
          console.error(`[PdfQueue] Worker reported error for ${job.id}:`, msg.data);
          await this.finishJob(job.id, {
            status: 'failed',
            progress: 0,
            errorMessage: msg.data || 'PDF पार्सिंग में समस्या आई।'
          });
        }
      });

      worker.on('error', async (err) => {
        console.error(`[PdfQueue] Worker execution error for ${job.id}:`, err);
        await this.finishJob(job.id, {
          status: 'failed',
          progress: 0,
          errorMessage: err.message || 'Worker thread execution error'
        });
      });

      worker.on('exit', async (code) => {
        const currentJob = this.getJob(job.id);
        if (code !== 0 && currentJob && currentJob.status !== 'completed' && currentJob.status !== 'failed') {
          console.error(`[PdfQueue] Worker exited with non-zero code ${code} for ${job.id}`);
          await this.finishJob(job.id, {
            status: 'failed',
            progress: 0,
            errorMessage: `Worker process exited with code ${code}`
          });
        }
      });

    } catch (spawnErr) {
      console.error(`[PdfQueue] Could not spawn worker for ${job.id}:`, spawnErr);
      await this.finishJob(job.id, {
        status: 'failed',
        progress: 0,
        errorMessage: `Worker spawn error: ${spawnErr.message}`
      });
    }
  }

  /**
   * Database persistence & finalization on worker 'done'
   */
  async handleJobCompletion(job, msg) {
    const operations = msg.data;
    const epicsCount = msg.epicsCount;

    try {
      if (operations && operations.length > 0) {
        // 1. Preserve existing photos if current upload did not extract photos
        try {
          const missingPhotoOps = operations.filter(op => !op.updateOne?.update?.$set?.photoUrl);
          if (missingPhotoOps.length > 0) {
            const existingVoters = await Voter.find({
              organizationId: job.organizationId,
              photoUrl: { $exists: true, $ne: '' }
            }, { serialNo: 1, epic: 1, photoUrl: 1, wardNo: 1 }).lean();

            const photoMapBySerial = new Map();
            const photoMapByEpic = new Map();
            for (const ev of existingVoters) {
              if (ev.serialNo) {
                photoMapBySerial.set(`${String(ev.wardNo || '').trim()}_${ev.serialNo}`, ev.photoUrl);
                photoMapBySerial.set(String(ev.serialNo), ev.photoUrl);
              }
              if (ev.epic) {
                photoMapByEpic.set(String(ev.epic).trim(), ev.photoUrl);
              }
            }

            for (const op of missingPhotoOps) {
              const f = op.updateOne?.filter;
              const s = op.updateOne?.update?.$set;
              if (f && s) {
                const existingUrl = photoMapBySerial.get(`${String(f.wardNo || '').trim()}_${f.serialNo}`)
                  || photoMapBySerial.get(String(f.serialNo))
                  || (s.epic ? photoMapByEpic.get(String(s.epic).trim()) : null);
                if (existingUrl) {
                  s.photoUrl = existingUrl;
                }
              }
            }
          }
        } catch (photoPreserveErr) {
          console.warn('[PdfQueue] Photo preservation warning:', photoPreserveErr.message);
        }

        // 2. Chunked MongoDB BulkWrite
        const CHUNK_SIZE = 2500;
        let processed = 0;
        for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
          const chunk = operations.slice(i, i + CHUNK_SIZE);
          await Voter.bulkWrite(chunk, { ordered: false });
          processed += chunk.length;
          const dbProgress = Math.floor((processed / operations.length) * 11);

          const currentJob = this.getJob(job.id);
          if (currentJob) {
            currentJob.progress = 88 + dbProgress;
            currentJob.stageMessage = `💾 सत्यापित डेटा डेटाबेस में सुरक्षित हो रहा है (${processed}/${operations.length})...`;
            await this.saveJob(currentJob);
          }
        }

        // 3. Automatic Ward Roll Synchronization (Remove stale serials)
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
              organizationId: job.organizationId,
              wardNo: wNo,
              serialNo: { $nin: Array.from(serials) }
            };
            if (pNo) cleanupFilter.partNo = pNo;
            try {
              const staleWithPhotos = await Voter.find(cleanupFilter, { photoUrl: 1 }).lean();
              const urls = staleWithPhotos.map(v => v.photoUrl).filter(Boolean);
              if (urls.length > 0) {
                const { deleteVoterPhotos } = require('./cloudinaryService');
                deleteVoterPhotos(urls).catch(e => console.warn('[PdfQueue] Cloudinary stale photo cleanup warning:', e.message));
              }
            } catch (photoErr) {
              console.warn('[PdfQueue] Cloudinary photo check failed:', photoErr.message);
            }
            const delRes = await Voter.deleteMany(cleanupFilter);
            if (delRes.deletedCount > 0) {
              console.log(`[PdfQueue] Synchronized Ward ${wNo}: Removed ${delRes.deletedCount} stale records.`);
            }
          }
        } catch (cleanErr) {
          console.warn('[PdfQueue] Ward synchronization cleanup warning:', cleanErr.message);
        }
      }

      // 4. Sync learned dictionary entries to DB
      try {
        const { syncFromDiskToDb } = require('./dictionaryService');
        await syncFromDiskToDb();
      } catch {}

      // 5. Invalidate cache
      try {
        const cache = require('./cache');
        if (cache && cache.flushAll) {
          cache.flushAll();
        }
      } catch {}

      console.log(`[PdfQueue] ✅ Job ${job.id} completed! Extracted ${epicsCount} voters. File: ${job.filename}`);

      await this.finishJob(job.id, {
        status: 'completed',
        progress: 100,
        stageMessage: '✅ सत्यापन व डिक्शनरी विस्तार पूर्ण! सभी मतदाता रिकॉर्ड्स सुरक्षित हो गए हैं।',
        extractedCount: epicsCount,
        excelPath: msg.excelPath,
        excelFilename: msg.excelFilename,
        hasExcel: Boolean(msg.excelPath),
        completedAt: new Date().toISOString()
      });

    } catch (dbError) {
      console.error(`[PdfQueue] Database write failed for Job ${job.id}:`, dbError);
      await this.finishJob(job.id, {
        status: 'failed',
        progress: 0,
        errorMessage: `डेटाबेस में सुरक्षित करने में त्रुटि: ${dbError.message}`
      });
    }
  }

  /**
   * Finalize current active job and immediately advance queue to next
   */
  async finishJob(jobId, updates) {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.activeWorker = null;

    const currentJob = this.getJob(jobId);
    if (currentJob) {
      Object.assign(currentJob, updates);
      await this.saveJob(currentJob);
    }

    this.isProcessing = false;
    this.activeJobId = null;

    // Trigger next queued job "hatho-hath"
    setImmediate(() => this.processNext());
  }

  /**
   * Queue telemetry & status
   */
  getQueueStatus() {
    return {
      engine: isRedisReady ? 'redis' : 'memory',
      isRedisReady,
      isProcessing: this.isProcessing,
      activeJobId: this.activeJobId,
      queueLength: this.inMemoryQueue.length,
      totalJobs: this.inMemoryJobs.size
    };
  }
}

// Global Singleton Instance
const pdfQueue = new PdfQueueManager();

// Periodic cleanup of jobs older than 2 hours
setInterval(() => {
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of pdfQueue.inMemoryJobs.entries()) {
    if (new Date(job.uploadedAt).getTime() < twoHoursAgo) {
      pdfQueue.deleteJob(id);
    }
  }
}, 15 * 60 * 1000);

module.exports = pdfQueue;
