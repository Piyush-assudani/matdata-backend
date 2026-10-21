const NodeCache = require('node-cache');
let Redis = null;
try {
  Redis = require('ioredis');
} catch (err) {
  // Graceful fallback if ioredis package is not installed on production server
}

// L1 Cache: High-speed In-Memory Cache (TTL: 300s = 5m)
const memoryCache = new NodeCache({ stdTTL: 300, checkperiod: 320 });

// L2 Cache: Redis Cache (Multi-Tenant & Distributed across instances)
let redisClient = null;
let isRedisReady = false;

const redisUrl = process.env.REDIS_URL || process.env.REDIS_URI;

if (redisUrl && Redis) {
  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => {
        if (times > 5) return null; // Stop retrying after 5 attempts
        return Math.min(times * 500, 2000);
      },
      connectTimeout: 3000,
      lazyConnect: true,
    });

    redisClient.on('connect', () => {
      console.log('⚡ [Cache] Redis connected successfully!');
      isRedisReady = true;
    });

    redisClient.on('ready', () => {
      isRedisReady = true;
    });

    redisClient.on('error', (err) => {
      if (isRedisReady) {
        console.warn('⚠️ [Cache] Redis connection lost, switching to in-memory fallback:', err.message);
      }
      isRedisReady = false;
    });

    redisClient.on('close', () => {
      isRedisReady = false;
    });

    redisClient.connect().catch((err) => {
      console.warn('⚠️ [Cache] Redis initial connection failed, using in-memory cache:', err.message);
      isRedisReady = false;
    });
  } catch (err) {
    console.warn('⚠️ [Cache] Failed to initialize Redis client, using in-memory cache:', err.message);
  }
} else {
  console.log('ℹ️ [Cache] No REDIS_URL configured; using in-memory high-speed cache.');
}

const cache = {
  // Synchronous getter (compatible with existing code)
  get(key) {
    return memoryCache.get(key);
  },

  // Asynchronous getter (checks L1 memory first, then L2 Redis)
  async getAsync(key) {
    const memVal = memoryCache.get(key);
    if (memVal !== undefined) return memVal;

    if (isRedisReady && redisClient) {
      try {
        const raw = await redisClient.get(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          // Populate L1 cache for subsequent instantaneous reads
          memoryCache.set(key, parsed);
          return parsed;
        }
      } catch (err) {
        console.warn(`[Cache] Redis get error for key ${key}:`, err.message);
      }
    }
    return undefined;
  },

  // Synchronous/fire-and-forget setter
  set(key, val, ttlSeconds = 300) {
    memoryCache.set(key, val, ttlSeconds);
    if (isRedisReady && redisClient) {
      try {
        const serialized = JSON.stringify(val);
        redisClient.set(key, serialized, 'EX', ttlSeconds).catch(() => {});
      } catch {
        // Serialization or network issue
      }
    }
    return true;
  },

  // Asynchronous setter
  async setAsync(key, val, ttlSeconds = 300) {
    memoryCache.set(key, val, ttlSeconds);
    if (isRedisReady && redisClient) {
      try {
        const serialized = JSON.stringify(val);
        await redisClient.set(key, serialized, 'EX', ttlSeconds);
      } catch (err) {
        console.warn(`[Cache] Redis set error for key ${key}:`, err.message);
      }
    }
    return true;
  },

  // Delete key
  del(key) {
    memoryCache.del(key);
    if (isRedisReady && redisClient) {
      redisClient.del(key).catch(() => {});
    }
    return true;
  },

  // Asynchronous delete
  async delAsync(key) {
    memoryCache.del(key);
    if (isRedisReady && redisClient) {
      try {
        await redisClient.del(key);
      } catch (err) {
        console.warn(`[Cache] Redis del error for key ${key}:`, err.message);
      }
    }
    return true;
  },

  // Invalidate all keys matching prefix
  delPrefix(prefix) {
    // 1. Delete from in-memory cache
    const memKeys = memoryCache.keys();
    memKeys.forEach((k) => {
      if (k.startsWith(prefix)) memoryCache.del(k);
    });

    // 2. Delete from Redis via non-blocking SCAN stream
    if (isRedisReady && redisClient) {
      const stream = redisClient.scanStream({
        match: `${prefix}*`,
        count: 100,
      });
      stream.on('data', (keys) => {
        if (keys && keys.length) {
          redisClient.del(...keys).catch(() => {});
        }
      });
      stream.on('error', () => {});
    }
  },

  // Get in-memory keys
  keys() {
    return memoryCache.keys();
  },

  // Flush all
  flush() {
    memoryCache.flushAll();
    if (isRedisReady && redisClient) {
      redisClient.flushdb().catch(() => {});
    }
  },

  flushAll() {
    this.flush();
  },

  // Status reporter for System Health & Telemetry
  getStatus() {
    return {
      engine: isRedisReady ? 'redis' : 'memory',
      isRedisReady,
      memoryKeysCount: memoryCache.keys().length,
      redisConfigured: Boolean(redisUrl),
    };
  },
};

module.exports = cache;
