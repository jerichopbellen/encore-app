const { randomUUID } = require('node:crypto')
const AppError = require('../utils/AppError')
const { getPrismaClient } = require('../config/prisma')
const { getPosterConfig } = require('../config/posters')
const cloudinaryGateway = require('./cloudinaryGateway')
const { publicEventFields } = require('./eventService')
const { CLOUDINARY_FORMATS } = require('../validators/posterValidator')

// How poster changes stay safe:
// - Every upload gets a fresh public ID, so an asset only ever belongs to one event.
// - A cleanup row is written before uploading. The transaction that attaches the
//   asset removes that row; if the request fails or the process stops first, the
//   row lets a later sweep delete the unused asset.
// - Replacing or removing a poster switches the event row first (under a row lock)
//   and records the old asset as "detached" in the same transaction. Cloudinary is
//   only asked to delete it after that commit.
// - Nothing deletes an asset that an event row still references.
// Attaching must finish within 10 minutes of the upload starting; the sweep only
// touches pending uploads older than 15 minutes, so the two never overlap.
const SWEEP_BATCH_SIZE = 5
// Poster requests retry only a couple of overdue cleanups, so the admin's response
// is not held up for long when Cloudinary is slow; the cleanup script does the rest.
const REQUEST_SWEEP_LIMIT = 2
// Test seam: lets tests force a failure after the event row is updated but before
// the attach transaction commits, to prove it rolls back and discards the upload.
const posterHooks = { beforeAttachCommit: null }
const STALE_POSTER_MESSAGE = 'This event\'s poster changed since you loaded it. Reload the event and try again.'

function logPosterWarning(event, details) {
  // Public IDs are not secrets; credentials, signatures, and file data are never logged.
  console.warn(JSON.stringify({ event, ...details }))
}

function safeHttpCode(error) {
  const code = error?.http_code ?? error?.error?.http_code
  return Number.isInteger(code) ? code : undefined
}

function buildPosterUrl(cloudName, version, publicId) {
  // A bounded, automatically compressed rendition; each layout crops it with CSS.
  return `https://res.cloudinary.com/${cloudName}/image/upload/c_limit,w_2000,f_auto,q_auto/v${version}/${publicId}`
}

function isExpectedUpload(result, publicId) {
  return Boolean(result)
    && result.public_id === publicId
    && result.resource_type === 'image'
    && result.type === 'upload'
    && result.existing !== true
    && CLOUDINARY_FORMATS.has(result.format)
    && [result.version, result.width, result.height, result.bytes].every((value) => Number.isSafeInteger(value) && value > 0)
}

function assertExpectedPoster(currentPublicId, expectedPublicId) {
  if ((currentPublicId ?? null) !== expectedPublicId) throw new AppError(STALE_POSTER_MESSAGE, 409)
}

async function lockEventPoster(tx, eventId) {
  const [locked] = await tx.$queryRaw`/* encore-poster-event-lock */
    SELECT poster_public_id FROM events WHERE id = ${eventId}::uuid FOR UPDATE`
  return locked
}

async function recordDetachedPoster(tx, publicId, eventId) {
  await tx.$executeRaw`
    INSERT INTO event_poster_cleanups (public_id, event_id, reason, created_at, updated_at)
    VALUES (${publicId}, ${eventId}::uuid, 'detached', clock_timestamp(), clock_timestamp())
    ON CONFLICT (public_id) DO UPDATE SET reason = 'detached', updated_at = clock_timestamp()`
}

// Deletes one recorded, unattached asset from Cloudinary. Safe to repeat and to
// call for an ID with no cleanup row. Never throws. Resolves to 'deleted',
// 'skipped' (nothing to delete, or the asset is still attached), or 'pending'
// (the attempt failed; the row stays for a later retry and a warning is logged).
async function cleanUpPosterAsset(publicId) {
  try {
    const prisma = await getPrismaClient()
    const claimed = await prisma.$queryRaw`
      UPDATE event_poster_cleanups AS cleanup
      SET attempts = cleanup.attempts + 1, updated_at = clock_timestamp()
      WHERE cleanup.public_id = ${publicId}
        AND NOT EXISTS (SELECT 1 FROM events WHERE events.poster_public_id = cleanup.public_id)
      RETURNING cleanup.event_id, cleanup.attempts`
    if (claimed.length === 0) {
      // Either already cleaned up, or still attached: drop a stale reminder, keep the asset.
      await prisma.$executeRaw`
        DELETE FROM event_poster_cleanups AS cleanup
        WHERE cleanup.public_id = ${publicId}
          AND EXISTS (SELECT 1 FROM events WHERE events.poster_public_id = cleanup.public_id)`
      return 'skipped'
    }

    const [{ event_id: eventId, attempts }] = claimed
    const warning = { event_id: eventId, public_id: publicId, attempts }
    if (!getPosterConfig().configured) {
      logPosterWarning('event_poster_cleanup_pending', { ...warning, reason: 'cloudinary_not_configured' })
      return 'pending'
    }

    let outcome
    try {
      outcome = await cloudinaryGateway.destroyImage(publicId)
    } catch (error) {
      logPosterWarning('event_poster_cleanup_pending', { ...warning, reason: 'cloudinary_error', http_code: safeHttpCode(error) })
      return 'pending'
    }
    if (outcome?.result !== 'ok' && outcome?.result !== 'not found') {
      logPosterWarning('event_poster_cleanup_pending', { ...warning, reason: 'unexpected_cloudinary_result' })
      return 'pending'
    }

    await prisma.$executeRaw`DELETE FROM event_poster_cleanups WHERE public_id = ${publicId}`
    return 'deleted'
  } catch (error) {
    logPosterWarning('event_poster_cleanup_pending', {
      public_id: publicId,
      reason: 'database_error',
      error_type: typeof error?.name === 'string' ? error.name : 'Error',
    })
    return 'pending'
  }
}

// Retries due cleanups. Runs after poster changes and from `npm run posters:cleanup`.
// With stopOnFailure, the sweep gives up at the first failed deletion instead of
// waiting on Cloudinary once per remaining row.
async function sweepPosterCleanups({ limit = SWEEP_BATCH_SIZE, stopOnFailure = false } = {}) {
  let due = []
  try {
    const prisma = await getPrismaClient()
    due = await prisma.$queryRaw`
      SELECT public_id FROM event_poster_cleanups
      WHERE (reason = 'detached' AND updated_at < clock_timestamp() - interval '5 minutes')
         OR (reason = 'pending_upload' AND created_at < clock_timestamp() - interval '15 minutes')
      ORDER BY updated_at, public_id
      LIMIT ${limit}::int`
  } catch (error) {
    logPosterWarning('event_poster_cleanup_sweep_failed', { error_type: typeof error?.name === 'string' ? error.name : 'Error' })
    return { attempted: 0, deleted: 0 }
  }
  let attempted = 0
  let deleted = 0
  for (const { public_id: publicId } of due) {
    attempted += 1
    const outcome = await cleanUpPosterAsset(publicId)
    if (outcome === 'deleted') deleted += 1
    if (outcome === 'pending' && stopOnFailure) break
  }
  return { attempted, deleted }
}

async function uploadEventPoster(eventId, { buffer, expectedPublicId }) {
  const config = getPosterConfig()
  if (!config.configured) {
    throw new AppError('Custom poster uploads are not configured on this server. The event keeps its default poster.', 503)
  }

  const prisma = await getPrismaClient()
  const existing = await prisma.events.findUnique({ where: { id: eventId }, select: { poster_public_id: true } })
  if (!existing) return null
  // Fail fast before uploading; the transaction below checks again under a lock.
  assertExpectedPoster(existing.poster_public_id, expectedPublicId)

  const publicId = `${config.folder}/${eventId}/${randomUUID()}`
  // Raw SQL so PostgreSQL stamps created_at: the attach window and sweep compare it with database time.
  await prisma.$executeRaw`
    INSERT INTO event_poster_cleanups (public_id, event_id, reason, created_at, updated_at)
    VALUES (${publicId}, ${eventId}::uuid, 'pending_upload', clock_timestamp(), clock_timestamp())`

  let result
  try {
    result = await cloudinaryGateway.uploadImage(buffer, {
      public_id: publicId,
      // On dynamic-folder Cloudinary accounts the public ID path does not choose the
      // Media Library folder, so file every poster in the configured folder as well.
      asset_folder: config.folder,
      overwrite: false,
      unique_filename: false,
      use_filename: false,
      allowed_formats: [...CLOUDINARY_FORMATS],
    })
  } catch (error) {
    // A timed-out upload may still finish inside Cloudinary, so its pending row is
    // left for the delayed sweep instead of being deleted straight away.
    if (safeHttpCode(error) === 400) {
      throw new AppError('Image storage could not read this file as an image. Choose a different JPEG, PNG, or WebP file.', 422)
    }
    throw new AppError('The poster could not be uploaded to image storage. Please try again.', 502)
  }
  if (!isExpectedUpload(result, publicId)) {
    await cleanUpPosterAsset(publicId)
    throw new AppError('Image storage returned an unexpected upload result. Please try again.', 502)
  }
  const posterUrl = buildPosterUrl(config.cloudName, result.version, publicId)

  let previousPublicId = null
  let event
  try {
    event = await prisma.$transaction(async (tx) => {
      const locked = await lockEventPoster(tx, eventId)
      if (!locked) throw new AppError('Event not found.', 404)
      // Another admin may have changed the poster while this file was uploading.
      assertExpectedPoster(locked.poster_public_id, expectedPublicId)

      // Claiming the pending row proves no sweep has deleted (or will delete) this asset.
      const claimed = await tx.$executeRaw`
        DELETE FROM event_poster_cleanups
        WHERE public_id = ${publicId}
          AND reason = 'pending_upload'
          AND created_at > clock_timestamp() - interval '10 minutes'`
      if (claimed !== 1) throw new AppError('The poster upload took too long to finish. Please try again.', 503)

      previousPublicId = locked.poster_public_id
      if (previousPublicId) await recordDetachedPoster(tx, previousPublicId, eventId)
      const updated = await tx.events.update({
        where: { id: eventId },
        data: { poster_public_id: publicId, poster_url: posterUrl },
        select: publicEventFields,
      })
      if (posterHooks.beforeAttachCommit) await posterHooks.beforeAttachCommit({ eventId, publicId })
      return updated
    })
  } catch (error) {
    // The event still shows its previous poster (or the default one); discard the new upload.
    await cleanUpPosterAsset(publicId)
    throw error
  }

  await cleanUpAfterPosterChange(previousPublicId)
  return event
}

// Runs after the database has switched away from the previous poster.
async function cleanUpAfterPosterChange(previousPublicId) {
  const outcome = previousPublicId ? await cleanUpPosterAsset(previousPublicId) : 'skipped'
  // If Cloudinary just failed, retrying older rows now would only delay the response.
  if (outcome !== 'pending') await sweepPosterCleanups({ limit: REQUEST_SWEEP_LIMIT, stopOnFailure: true })
}

async function removeEventPoster(eventId, { expectedPublicId }) {
  const prisma = await getPrismaClient()
  let previousPublicId = null
  const event = await prisma.$transaction(async (tx) => {
    const locked = await lockEventPoster(tx, eventId)
    if (!locked) return null
    // Removing an already-default poster is a harmless repeat, so it succeeds.
    if (locked.poster_public_id === null) {
      return tx.events.findUnique({ where: { id: eventId }, select: publicEventFields })
    }
    assertExpectedPoster(locked.poster_public_id, expectedPublicId)

    previousPublicId = locked.poster_public_id
    await recordDetachedPoster(tx, previousPublicId, eventId)
    return tx.events.update({
      where: { id: eventId },
      data: { poster_public_id: null, poster_url: null },
      select: publicEventFields,
    })
  })
  if (!event) return null

  await cleanUpAfterPosterChange(previousPublicId)
  return event
}

module.exports = {
  uploadEventPoster,
  removeEventPoster,
  sweepPosterCleanups,
  cleanUpPosterAsset,
  buildPosterUrl,
  posterHooks,
}
