const cloudinary = require('cloudinary').v2;
const fs = require('fs');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'jic216fs',
  api_key: process.env.CLOUDINARY_API_KEY || '791945255884761',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'dKZNCFIGTiVR4YCh2sd0P7Zf0uI'
});

/**
 * Upload a single voter photo to Cloudinary
 * @param {string} filePath - Absolute path to photo on disk
 * @param {string} publicId - Cloudinary public_id
 * @param {string} folder - Destination folder
 * @returns {Promise<string|null>} - secure_url or null
 */
async function uploadSinglePhoto(filePath, publicId, folder = 'voters') {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const res = await cloudinary.uploader.upload(filePath, {
      folder,
      public_id: publicId,
      overwrite: true,
      resource_type: 'image',
      format: 'webp',
    });
    return res.secure_url || null;
  } catch (err) {
    console.warn(`[cloudinaryService] Upload failed for ${publicId}:`, err.message);
    return null;
  }
}

/**
 * Batch upload voter photos with concurrency control
 * @param {Array<{ filePath: string, publicId: string }>} items
 * @param {number} concurrency
 * @param {(done: number, total: number) => void} onProgress
 * @returns {Promise<Map<string, string>>} - Map of publicId -> secure_url
 */
async function uploadVoterPhotosBatch(items, concurrency = 15, onProgress = null) {
  const results = new Map();
  if (!items || items.length === 0) return results;

  let completed = 0;
  const total = items.length;

  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkPromises = chunk.map(async (item) => {
      const url = await uploadSinglePhoto(item.filePath, item.publicId);
      if (url) {
        results.set(item.publicId, url);
      }
      completed++;
      if (onProgress && (completed % 10 === 0 || completed === total)) {
        onProgress(completed, total);
      }
    });

    await Promise.all(chunkPromises);
  }

  return results;
}

module.exports = {
  cloudinary,
  uploadSinglePhoto,
  uploadVoterPhotosBatch
};
