const express = require('express')
const AppError = require('../utils/AppError')
const { getPosterConfig } = require('../config/posters')
const { POSTER_CONTENT_TYPES, normalizeContentType, normalizeExpectedPoster } = require('../validators/posterValidator')
const { validateEventId } = require('../validators/eventValidator')

function formatMegabytes(bytes) {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

// Reads a poster upload sent as the raw request body (the browser sends the
// File directly with its image Content-Type). The body is bounded by
// POSTER_UPLOAD_MAX_BYTES and compressed request bodies are refused. This runs
// after the admin authorization middleware, so only administrators' bodies are read,
// and only once the event ID and expected_poster precondition are well formed.
function readPosterUpload(req, res, next) {
  validateEventId(req.params.eventId)
  normalizeExpectedPoster(req.query.expected_poster)

  const contentType = normalizeContentType(req.get('Content-Type'))
  if (!POSTER_CONTENT_TYPES.has(contentType)) {
    return next(new AppError('The poster must be a JPEG, PNG, or WebP image.', 415))
  }

  const { maxBytes } = getPosterConfig()
  const tooLarge = new AppError(`The poster must be ${formatMegabytes(maxBytes)} or smaller.`, 413)
  const declaredLength = req.get('Content-Length')
  if (declaredLength !== undefined && (!/^\d+$/.test(declaredLength))) {
    return next(new AppError('The poster upload could not be read.', 400))
  }
  if (declaredLength !== undefined && Number(declaredLength) > maxBytes) return next(tooLarge)

  const parseBody = express.raw({ type: () => true, limit: maxBytes, inflate: false })
  return parseBody(req, res, (error) => {
    if (!error) return next()
    if (error.type === 'entity.too.large') return next(tooLarge)
    if (error.type === 'encoding.unsupported') {
      return next(new AppError('Compressed poster uploads are not supported.', 415))
    }
    return next(new AppError('The poster upload could not be read. Please try again.', 400))
  })
}

module.exports = { readPosterUpload }
