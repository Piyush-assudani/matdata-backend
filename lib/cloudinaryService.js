const fs = require('fs');
let cloudinary = null;
try {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'jic216fs',
    api_key: process.env.CLOUDINARY_API_KEY || '791945255884761',
    api_secret: process.env.CLOUDINARY_API_SECRET || 'dKZNCFIGTiVR4YCh2sd0P7Zf0uI'
  });
} catch (err) {
  console.warn('[cloudinaryService] Cloudinary module not loaded (run npm install in backend):', err.message);
}

/**
 * Upload a single voter photo to Cloudinary
 * @param {string} filePath - Absolute path to photo on disk
 * @param {string} publicId - Cloudinary public_id
 * @param {string} folder - Destination folder
 * @returns {Promise<string|null>} - secure_url or null
 */
async function uploadSinglePhoto(filePath, publicId, folder = 'voters') {
  if (!cloudinary) {
    console.warn('[cloudinaryService] Cloudinary not available, skipping cloud upload');
    return null;
  }
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

/**
 * Extract Cloudinary public_id from a secure_url
 * e.g. https://res.cloudinary.com/cloud/image/upload/v1234/voters/tenant_w2_s1.webp -> voters/tenant_w2_s1
 */
function getPublicIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/upload\/(?:v\d+\/)?([^\.]+)/);
  return match ? match[1] : null;
}

/**
 * Delete a single photo from Cloudinary
 * @param {string} photoUrlOrPublicId
 */
async function deleteSinglePhoto(photoUrlOrPublicId) {
  if (!cloudinary || !photoUrlOrPublicId) return false;
  try {
    const publicId = photoUrlOrPublicId.includes('cloudinary')
      ? getPublicIdFromUrl(photoUrlOrPublicId)
      : photoUrlOrPublicId;
    if (!publicId) return false;
    await cloudinary.uploader.destroy(publicId);
    return true;
  } catch (err) {
    console.warn(`[cloudinaryService] deleteSinglePhoto failed for ${photoUrlOrPublicId}:`, err.message);
    return false;
  }
}

/**
 * Batch delete voter photos from Cloudinary by URLs or publicIds
 * @param {string[]} photoUrlsOrPublicIds
 */
async function deleteVoterPhotos(photoUrlsOrPublicIds) {
  if (!cloudinary || !Array.isArray(photoUrlsOrPublicIds) || photoUrlsOrPublicIds.length === 0) return 0;
  const publicIds = photoUrlsOrPublicIds
    .map(u => (u && u.includes('cloudinary') ? getPublicIdFromUrl(u) : u))
    .filter(Boolean);
  if (publicIds.length === 0) return 0;

  let deletedCount = 0;
  for (let i = 0; i < publicIds.length; i += 100) {
    const chunk = publicIds.slice(i, i + 100);
    try {
      const res = await cloudinary.api.delete_resources(chunk);
      if (res && res.deleted) {
        deletedCount += Object.keys(res.deleted).length;
      }
    } catch (err) {
      console.warn('[cloudinaryService] deleteVoterPhotos error chunk:', err.message);
    }
  }
  return deletedCount;
}

/**
 * Delete all photos belonging to an entire client / organization
 * All voter photos for a tenant start with prefix: voters/${organizationId}
 * @param {string} organizationId
 */
async function deleteOrganizationPhotos(organizationId) {
  if (!cloudinary || !organizationId) return false;
  try {
    const prefix = `voters/${organizationId}`;
    console.log(`[cloudinaryService] Purging all cloud photos for tenant prefix: ${prefix}`);
    await cloudinary.api.delete_resources_by_prefix(prefix);
    return true;
  } catch (err) {
    console.warn(`[cloudinaryService] deleteOrganizationPhotos error for ${organizationId}:`, err.message);
    return false;
  }
}

module.exports = {
  cloudinary,
  uploadSinglePhoto,
  uploadVoterPhotosBatch,
  getPublicIdFromUrl,
  deleteSinglePhoto,
  deleteVoterPhotos,
  deleteOrganizationPhotos
};

