const { disconnectPrisma } = require('../src/config/prisma')
const { validatePosterEnvironment } = require('../src/config/posters')
const { sweepPosterCleanups } = require('../src/services/eventPosterService')

// Retries Cloudinary deletions that an earlier poster replacement, removal, or
// failed upload could not finish. Only unattached assets recorded in
// event_poster_cleanups are deleted; the poster an event currently shows is never touched.
const BATCH_SIZE = 50

async function cleanUpPendingPosters() {
  const { configured } = validatePosterEnvironment(process.env)
  if (!configured) throw new Error('Set the Cloudinary variables in server/.env before running poster cleanup.')

  let attempted = 0
  let deleted = 0
  // Stop when a batch makes no progress, so persistent failures cannot loop forever.
  for (;;) {
    const batch = await sweepPosterCleanups({ limit: BATCH_SIZE })
    attempted += batch.attempted
    deleted += batch.deleted
    if (batch.attempted < BATCH_SIZE || batch.deleted === 0) break
  }
  console.log(`Poster cleanup finished: ${deleted} of ${attempted} due asset(s) deleted.`)
  if (deleted < attempted) {
    console.log('Assets that could not be deleted stay recorded; check the event_poster_cleanup_pending warnings and retry later.')
  }
}

cleanUpPendingPosters()
  .catch((error) => {
    console.error(error.message.startsWith('Set the Cloudinary') || error.message.startsWith('CLOUDINARY_')
      ? error.message
      : 'Could not run poster cleanup. Check the server database configuration and try again.')
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await disconnectPrisma()
    } catch {
      console.error('Could not close the database connection cleanly.')
      process.exitCode = 1
    }
  })
