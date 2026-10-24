const AppError = require('../utils/AppError')

// Raster formats only. SVG and other formats that can carry scripts are never accepted.
const POSTER_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
// What Cloudinary reports as `format` for each accepted type.
const CLOUDINARY_FORMATS = new Set(['jpg', 'png', 'webp'])
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function normalizeContentType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase()
}

// Identify the image from its leading bytes; the filename and declared type are not trusted.
function detectImageType(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(PNG_SIGNATURE) && buffer.toString('latin1', 12, 16) === 'IHDR') {
    return 'image/png'
  }
  if (buffer.length >= 16 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP'
    && /^VP8[ LX]$/.test(buffer.toString('latin1', 12, 16))) {
    return 'image/webp'
  }
  return null
}

function validatePosterUpload(buffer, declaredContentType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AppError('Choose an image file to upload as the poster.', 400)
  }
  const detectedType = detectImageType(buffer)
  if (!detectedType) {
    throw new AppError('The poster must be a valid JPEG, PNG, or WebP image.', 415)
  }
  if (detectedType !== normalizeContentType(declaredContentType)) {
    throw new AppError('The poster file content does not match its declared image type.', 415)
  }
  return detectedType
}

// The precondition names the poster the admin is looking at ("none" for the
// default poster). It only guards against stale edits; it never chooses which
// asset is deleted — that always comes from the locked database row.
function normalizeExpectedPoster(value) {
  if (typeof value !== 'string' || !value) {
    throw new AppError('expected_poster is required: use the current poster_public_id, or "none" when the event has no custom poster.', 400)
  }
  if (value === 'none') return null
  if (value.length > 255 || !PUBLIC_ID_PATTERN.test(value)) {
    throw new AppError('expected_poster must be the event\'s current poster_public_id or "none".', 400)
  }
  return value
}

module.exports = {
  POSTER_CONTENT_TYPES,
  CLOUDINARY_FORMATS,
  normalizeContentType,
  detectImageType,
  validatePosterUpload,
  normalizeExpectedPoster,
}
