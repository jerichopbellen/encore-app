// Admin event poster uploads. Cloudinary credentials stay on the server; the
// browser only ever sends image bytes to the Encore API.
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024
const MIN_MAX_BYTES = 1024
// Cloudinary's free plan rejects images over 10 MB.
const MAX_MAX_BYTES = 10 * 1024 * 1024
const DEFAULT_FOLDER = 'encore/event-posters'
const CLOUDINARY_VARIABLES = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']
const CLOUD_NAME_PATTERN = /^[A-Za-z0-9_-]{1,100}$/
const FOLDER_PATTERN = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/

function parseMaxBytes(value) {
  if (value === undefined || String(value).trim() === '') return DEFAULT_MAX_BYTES
  if (!/^\d+$/.test(String(value).trim())) {
    throw new Error(`POSTER_UPLOAD_MAX_BYTES must be a whole number of bytes between ${MIN_MAX_BYTES} and ${MAX_MAX_BYTES}.`)
  }
  const maxBytes = Number(String(value).trim())
  if (!Number.isSafeInteger(maxBytes) || maxBytes < MIN_MAX_BYTES || maxBytes > MAX_MAX_BYTES) {
    throw new Error(`POSTER_UPLOAD_MAX_BYTES must be a whole number of bytes between ${MIN_MAX_BYTES} and ${MAX_MAX_BYTES}.`)
  }
  return maxBytes
}

function parseFolder(value) {
  const folder = String(value ?? '').trim() || DEFAULT_FOLDER
  if (folder.length > 120 || !FOLDER_PATTERN.test(folder)) {
    throw new Error('CLOUDINARY_POSTER_FOLDER may contain only letters, numbers, "_", "-", and "/" between path segments.')
  }
  return folder
}

// Read at request time (not cached), like the payment configuration.
function getPosterConfig(env = process.env) {
  const values = CLOUDINARY_VARIABLES.map((name) => String(env[name] ?? '').trim())
  const [cloudName, apiKey, apiSecret] = values
  return {
    configured: values.every(Boolean),
    cloudName,
    apiKey,
    apiSecret,
    folder: parseFolder(env.CLOUDINARY_POSTER_FOLDER),
    maxBytes: parseMaxBytes(env.POSTER_UPLOAD_MAX_BYTES),
  }
}

// Poster uploads are optional: with no Cloudinary variables the API starts and
// every event keeps its generated poster. A partial setup is a mistake, so it
// fails startup. Error messages never include the configured values.
function validatePosterEnvironment(env = process.env) {
  const config = getPosterConfig(env)
  const provided = CLOUDINARY_VARIABLES.filter((name) => String(env[name] ?? '').trim())
  if (provided.length > 0 && provided.length < CLOUDINARY_VARIABLES.length) {
    throw new Error('CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET must be set together to enable poster uploads.')
  }
  if (config.configured && !CLOUD_NAME_PATTERN.test(config.cloudName)) {
    throw new Error('CLOUDINARY_CLOUD_NAME must be a Cloudinary cloud name, not a URL.')
  }
  return { configured: config.configured }
}

module.exports = {
  getPosterConfig,
  validatePosterEnvironment,
  DEFAULT_MAX_BYTES,
  MAX_MAX_BYTES,
}
