const test = require('node:test')
const assert = require('node:assert/strict')
const { gzipSync } = require('node:zlib')
const { randomBytes, randomUUID } = require('node:crypto')
const { configureTestDatabase } = require('../helpers/testDatabase.cjs')

// Configure Prisma before requiring the app: the ordinary server/.env is never
// allowed to select a database for this suite.
configureTestDatabase()

// Dummy, test-only Cloudinary settings. No test in this file reaches Cloudinary:
// uploads and deletions go to the in-memory gateway below.
const CLOUDINARY_TEST_SECRET = 'cloudinary-integration-test-only-secret'
process.env.NODE_ENV = 'test'
process.env.PAYMENT_PROVIDER = 'simulated'
process.env.CLOUDINARY_CLOUD_NAME = 'encore-test-cloud'
process.env.CLOUDINARY_API_KEY = 'cloudinary-test-key'
process.env.CLOUDINARY_API_SECRET = CLOUDINARY_TEST_SECRET
process.env.CLOUDINARY_POSTER_FOLDER = 'encore-test/event-posters'
process.env.POSTER_UPLOAD_MAX_BYTES = '4096'

const app = require('../../server/src/app')
const { getPrismaClient, disconnectPrisma } = require('../../server/src/config/prisma')
const { setGatewayForTests } = require('../../server/src/services/cloudinaryGateway')
const { sweepPosterCleanups, posterHooks } = require('../../server/src/services/eventPosterService')

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), randomBytes(32)])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/></svg>')
const FORMATS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

function makeBarrier(parties) {
  let ready = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  return async () => {
    ready += 1
    if (ready === parties) release()
    await gate
  }
}

// Mimics the parts of Cloudinary Encore relies on: overwrite-free uploads under a
// requested public ID and idempotent deletion ("ok" or "not found").
function createFakeCloudinary() {
  const fake = {
    assets: new Map(),
    uploads: [],
    destroys: [],
    nextVersion: 1_760_000_000,
    beforeUpload: null,
    uploadError: null,
    destroyError: null,
    transformResult: null,
    reset() {
      fake.uploads = []
      fake.destroys = []
      fake.beforeUpload = null
      fake.uploadError = null
      fake.destroyError = null
      fake.transformResult = null
    },
    gateway: {
      async uploadImage(buffer, options) {
        fake.uploads.push(options.public_id)
        assert.equal(options.overwrite, false)
        assert.deepEqual(options.allowed_formats, ['jpg', 'png', 'webp'])
        // Posters are filed in the configured Media Library folder as well as under its public ID prefix.
        assert.equal(options.asset_folder, 'encore-test/event-posters')
        assert.equal(options.public_id.startsWith(`${options.asset_folder}/`), true)
        if (fake.beforeUpload) await fake.beforeUpload(options)
        if (fake.uploadError) throw fake.uploadError
        const contentType = buffer[0] === 0x89 ? 'image/png' : buffer[0] === 0xff ? 'image/jpeg' : 'image/webp'
        const result = {
          public_id: options.public_id,
          version: fake.nextVersion++,
          resource_type: 'image',
          type: 'upload',
          format: FORMATS[contentType],
          width: 1200,
          height: 900,
          bytes: buffer.length,
        }
        fake.assets.set(options.public_id, result)
        return fake.transformResult ? fake.transformResult(result) : result
      },
      async destroyImage(publicId) {
        fake.destroys.push(publicId)
        if (fake.destroyError) throw fake.destroyError
        return { result: fake.assets.delete(publicId) ? 'ok' : 'not found' }
      },
    },
  }
  return fake
}

function cookieFromLogin(response) {
  const headers = response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || '']
  const sessionCookie = headers.find((value) => /^encore_session=/i.test(value))
  assert.equal(Boolean(sessionCookie), true, 'Login should set an Encore session cookie.')
  return sessionCookie.split(';', 1)[0]
}

test('admin event posters against the dedicated PostgreSQL test database', async (t) => {
  const prisma = await getPrismaClient()
  const fake = createFakeCloudinary()
  setGatewayForTests(fake.gateway)
  const warnings = []
  t.mock.method(console, 'warn', (line) => { warnings.push(String(line)) })
  const fixture = { emails: [], userIds: [], eventIds: [], ticketTypeIds: [], reservationIds: [], server: null }
  let databaseReady = false

  async function request(path, { method = 'GET', body, rawBody, cookie, headers = {} } = {}) {
    const response = await fetch(`${fixture.baseUrl}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(rawBody !== undefined ? { body: rawBody } : {}),
    })
    return { response, payload: await response.json().catch(() => null) }
  }

  async function createAccount(name) {
    const email = `encore-posters-${randomUUID()}@example.test`
    fixture.emails.push(email)
    const password = randomBytes(24).toString('base64url')
    const registration = await request('/api/auth/register', { method: 'POST', body: { name, email, password } })
    assert.equal(registration.response.status, 201)
    fixture.userIds.push(registration.payload.data.user.id)
    const login = await request('/api/auth/login', { method: 'POST', body: { email, password } })
    assert.equal(login.response.status, 200)
    return { id: registration.payload.data.user.id, cookie: cookieFromLogin(login.response) }
  }

  async function createEventThroughApi(admin, title = 'Poster Fixture') {
    const created = await request('/api/admin/events', {
      method: 'POST',
      cookie: admin.cookie,
      body: { title: `${title} ${randomUUID()}`, venue: 'Encore Test Hall', starts_at: new Date(Date.now() + 86400000).toISOString() },
    })
    assert.equal(created.response.status, 201)
    fixture.eventIds.push(created.payload.data.id)
    return created.payload.data
  }

  // Pass expected: null to omit the expected_poster precondition entirely.
  function uploadPoster(admin, eventId, { image = PNG, contentType = 'image/png', expected = 'none', headers = {} } = {}) {
    const query = expected === null ? '' : `?${new URLSearchParams({ expected_poster: expected })}`
    return request(`/api/admin/events/${eventId}/poster${query}`, {
      method: 'POST',
      cookie: admin?.cookie,
      rawBody: image,
      headers: { ...(contentType ? { 'Content-Type': contentType } : {}), ...headers },
    })
  }

  function removePoster(admin, eventId, expected = 'none') {
    const query = expected === null ? '' : `?${new URLSearchParams({ expected_poster: expected })}`
    return request(`/api/admin/events/${eventId}/poster${query}`, { method: 'DELETE', cookie: admin?.cookie })
  }

  async function storedPoster(eventId) {
    return prisma.events.findUnique({ where: { id: eventId }, select: { poster_public_id: true, poster_url: true } })
  }

  async function cleanupRows(eventId) {
    return prisma.event_poster_cleanups.findMany({ where: { event_id: eventId }, orderBy: { public_id: 'asc' } })
  }

  // Ages cleanup rows so the delayed sweep treats them as due (it compares with database time).
  async function ageCleanupRows(eventId) {
    await prisma.$executeRaw`
      UPDATE event_poster_cleanups
      SET created_at = clock_timestamp() - interval '1 hour', updated_at = clock_timestamp() - interval '1 hour'
      WHERE event_id = ${eventId}::uuid`
  }

  try {
    try {
      await prisma.$queryRaw`SELECT 1`
      const counts = await Promise.all([
        prisma.users, prisma.events, prisma.ticket_types, prisma.reservations, prisma.reservation_items,
        prisma.bookings, prisma.idempotency_keys, prisma.payment_attempts, prisma.stripe_webhook_events,
        prisma.event_poster_cleanups,
      ].map((table) => table.count()))
      if (counts.some((count) => count > 0)) {
        throw new Error('The dedicated integration-test database must be empty before a run. Use a separate empty database; the suite does not clean pre-existing data.')
      }
    } catch (error) {
      if (/must be empty/.test(error.message)) throw error
      const safeCode = typeof error.code === 'string' && /^[A-Z0-9]+$/.test(error.code) ? ` (database error ${error.code})` : ''
      throw new Error(`The dedicated test database is unavailable or is missing the event poster migration (20261024000000_event_posters)${safeCode}. Prepare only the database named in TEST_DATABASE_URL before running integration tests.`)
    }
    databaseReady = true

    fixture.server = app.listen(0, '127.0.0.1')
    await new Promise((resolve, reject) => {
      fixture.server.once('listening', resolve)
      fixture.server.once('error', reject)
    })
    fixture.baseUrl = `http://127.0.0.1:${fixture.server.address().port}`

    const admin = await createAccount('Poster Admin')
    await prisma.users.update({ where: { id: admin.id }, data: { role: 'admin' } })
    const customer = await createAccount('Poster Customer')

    await t.test('events created without an image keep the default poster', async () => {
      fake.reset()
      const event = await createEventThroughApi(admin)
      assert.equal(event.poster_url, null)
      assert.equal(event.poster_public_id, null)
      assert.deepEqual(await storedPoster(event.id), { poster_public_id: null, poster_url: null })

      await prisma.events.update({ where: { id: event.id }, data: { status: 'published' } })
      const details = await request(`/api/events/${event.id}`)
      assert.equal(details.response.status, 200)
      assert.equal(details.payload.data.poster_url, null)
      assert.equal(Object.hasOwn(details.payload.data, 'poster_public_id'), false)
      const catalogue = await request(`/api/events?q=${encodeURIComponent(event.title)}`)
      assert.equal(catalogue.payload.data.events[0].poster_url, null)

      // Ordinary event edits can never set poster fields directly.
      for (const field of ['poster_url', 'poster_public_id']) {
        const edit = await request(`/api/admin/events/${event.id}`, {
          method: 'PATCH', cookie: admin.cookie, body: { [field]: 'https://example.test/evil.png' },
        })
        assert.equal(edit.response.status, 400)
      }
      assert.deepEqual(await storedPoster(event.id), { poster_public_id: null, poster_url: null })
      assert.equal(fake.uploads.length, 0)
    })

    await t.test('only administrators can upload, replace, or remove posters', async () => {
      fake.reset()
      const event = await createEventThroughApi(admin)
      for (const actor of [null, customer]) {
        const upload = await uploadPoster(actor, event.id)
        assert.equal(upload.response.status, actor ? 403 : 401)
        const removal = await removePoster(actor, event.id)
        assert.equal(removal.response.status, actor ? 403 : 401)
      }

      const attached = await uploadPoster(admin, event.id)
      assert.equal(attached.response.status, 200)
      const publicId = attached.payload.data.poster_public_id
      for (const actor of [null, customer]) {
        assert.equal((await uploadPoster(actor, event.id, { expected: publicId })).response.status, actor ? 403 : 401)
        assert.equal((await removePoster(actor, event.id, publicId)).response.status, actor ? 403 : 401)
      }
      assert.equal((await storedPoster(event.id)).poster_public_id, publicId)
      assert.equal(fake.assets.has(publicId), true)
      assert.deepEqual(fake.destroys, [])
      fake.reset()
    })

    await t.test('a valid upload attaches exactly the verified Cloudinary asset', async () => {
      fake.reset()
      const event = await createEventThroughApi(admin)
      await prisma.events.update({ where: { id: event.id }, data: { status: 'published' } })

      for (const [image, contentType] of [[PNG, 'image/png'], [JPEG, 'image/jpeg'], [WEBP, 'image/webp']]) {
        const before = await storedPoster(event.id)
        const upload = await uploadPoster(admin, event.id, { image, contentType, expected: before.poster_public_id || 'none' })
        assert.equal(upload.response.status, 200, upload.payload?.message)
        const publicId = upload.payload.data.poster_public_id
        assert.match(publicId, new RegExp(`^encore-test/event-posters/${event.id}/[0-9a-f-]{36}$`))
        const asset = fake.assets.get(publicId)
        assert.ok(asset, 'The attached asset exists in Cloudinary.')
        const expectedUrl = `https://res.cloudinary.com/encore-test-cloud/image/upload/c_limit,w_2000,f_auto,q_auto/v${asset.version}/${publicId}`
        assert.equal(upload.payload.data.poster_url, expectedUrl)
        assert.deepEqual(await storedPoster(event.id), { poster_public_id: publicId, poster_url: expectedUrl })
      }
      // Each upload replaced the previous one, whose asset was deleted after the switch.
      assert.equal(fake.uploads.length, 3)
      assert.deepEqual(fake.destroys, fake.uploads.slice(0, 2))
      assert.deepEqual(await cleanupRows(event.id), [])

      const { poster_url: posterUrl } = await storedPoster(event.id)
      const details = await request(`/api/events/${event.id}`)
      assert.equal(details.payload.data.poster_url, posterUrl)
      const catalogue = await request(`/api/events?q=${encodeURIComponent(event.title)}`)
      assert.equal(catalogue.payload.data.events[0].poster_url, posterUrl)
      const adminList = await request('/api/admin/events', { cookie: admin.cookie })
      assert.equal(adminList.payload.data.find(({ id }) => id === event.id).poster_url, posterUrl)
      fake.reset()
    })

    await t.test('invalid, unsupported, oversized, and malformed uploads are rejected without side effects', async () => {
      fake.reset()
      const event = await createEventThroughApi(admin)
      const cases = [
        { name: 'SVG content type', options: { image: SVG, contentType: 'image/svg+xml' }, status: 415 },
        { name: 'SVG disguised as PNG', options: { image: SVG, contentType: 'image/png' }, status: 415 },
        { name: 'HTML disguised as JPEG', options: { image: Buffer.from('<html><script>alert(1)</script></html>'), contentType: 'image/jpeg' }, status: 415 },
        { name: 'GIF', options: { image: Buffer.from('GIF89a\x01\x00\x01\x00'), contentType: 'image/gif' }, status: 415 },
        { name: 'PNG declared as JPEG', options: { image: PNG, contentType: 'image/jpeg' }, status: 415 },
        { name: 'multipart body', options: { image: Buffer.from('--x\r\n\r\n'), contentType: 'multipart/form-data; boundary=x' }, status: 415 },
        { name: 'JSON body', options: { image: Buffer.from('{"url":"https://example.test/a.png"}'), contentType: 'application/json' }, status: 415 },
        { name: 'missing content type', options: { image: PNG, contentType: null }, status: 415 },
        { name: 'empty body', options: { image: Buffer.alloc(0) }, status: 400 },
        { name: 'truncated PNG', options: { image: PNG.subarray(0, 12) }, status: 415 },
        { name: 'oversized image', options: { image: Buffer.concat([PNG, Buffer.alloc(5000)]) }, status: 413 },
        { name: 'compressed body', options: { image: gzipSync(PNG), headers: { 'Content-Encoding': 'gzip' } }, status: 415 },
        { name: 'missing precondition', options: { expected: null }, status: 400 },
        { name: 'URL as precondition', options: { expected: 'https://res.cloudinary.com/x/image/upload/v1/a' }, status: 400 },
      ]
      for (const { name, options, status } of cases) {
        const result = await uploadPoster(admin, event.id, options)
        assert.equal(result.response.status, status, `${name}: ${result.payload?.message}`)
        assert.equal(result.payload.success, false)
      }
      const oversized = await uploadPoster(admin, event.id, { image: Buffer.concat([PNG, Buffer.alloc(5000)]) })
      assert.match(oversized.payload.message, /MB or smaller/)

      assert.equal((await uploadPoster(admin, 'not-a-uuid')).response.status, 400)
      // An invalid target is rejected before the (oversized) body is considered.
      const invalidTarget = await uploadPoster(admin, 'not-a-uuid', { image: Buffer.concat([PNG, Buffer.alloc(5000)]) })
      assert.equal(invalidTarget.response.status, 400)
      assert.equal((await uploadPoster(admin, event.id, { expected: null, image: Buffer.concat([PNG, Buffer.alloc(5000)]) })).response.status, 400)
      const missingEvent = await uploadPoster(admin, randomUUID())
      assert.equal(missingEvent.response.status, 404)
      assert.equal((await removePoster(admin, randomUUID())).response.status, 404)
      assert.equal((await removePoster(admin, event.id, null)).response.status, 400)

      assert.deepEqual(fake.uploads, [], 'Rejected uploads never reach Cloudinary.')
      assert.deepEqual(await storedPoster(event.id), { poster_public_id: null, poster_url: null })
      assert.deepEqual(await cleanupRows(event.id), [])
    })

    await t.test('uploads are refused clearly when Cloudinary is not configured', async () => {
      fake.reset()
      const event = await createEventThroughApi(admin)
      process.env.CLOUDINARY_API_SECRET = ''
      try {
        const result = await uploadPoster(admin, event.id)
        assert.equal(result.response.status, 503)
        assert.match(result.payload.message, /not configured/)
      } finally {
        process.env.CLOUDINARY_API_SECRET = CLOUDINARY_TEST_SECRET
      }
      assert.deepEqual(fake.uploads, [])
      assert.deepEqual(await storedPoster(event.id), { poster_public_id: null, poster_url: null })
    })

    await t.test('removing a custom poster restores the default and is safe to repeat', async () => {
      fake.reset()
      const event = await createEventThroughApi(admin)
      await prisma.events.update({ where: { id: event.id }, data: { status: 'published' } })
      const upload = await uploadPoster(admin, event.id)
      const publicId = upload.payload.data.poster_public_id

      const removal = await removePoster(admin, event.id, publicId)
      assert.equal(removal.response.status, 200)
      assert.equal(removal.payload.data.poster_url, null)
      assert.equal(removal.payload.data.poster_public_id, null)
      assert.deepEqual(await storedPoster(event.id), { poster_public_id: null, poster_url: null })
      assert.equal(fake.assets.has(publicId), false)
      assert.deepEqual(fake.destroys, [publicId])
      assert.deepEqual(await cleanupRows(event.id), [])
      assert.equal((await request(`/api/events/${event.id}`)).payload.data.poster_url, null)

      // A retried removal (for example after a lost response) succeeds without touching Cloudinary.
      for (const expected of [publicId, 'none']) {
        const repeat = await removePoster(admin, event.id, expected)
        assert.equal(repeat.response.status, 200)
        assert.equal(repeat.payload.data.poster_url, null)
      }
      assert.deepEqual(fake.destroys, [publicId])
      fake.reset()
    })

    await t.test('replacement keeps the new poster and records the old asset when its deletion fails', async () => {
      fake.reset()
      const event = await createEventThroughApi(admin)
      const first = (await uploadPoster(admin, event.id)).payload.data.poster_public_id
      fake.destroyError = Object.assign(new Error(`Cloudinary unavailable ${CLOUDINARY_TEST_SECRET}`), { http_code: 500 })

      const replaced = await uploadPoster(admin, event.id, { image: JPEG, contentType: 'image/jpeg', expected: first })
      assert.equal(replaced.response.status, 200)
      const second = replaced.payload.data.poster_public_id
      assert.notEqual(second, first)
      assert.equal((await storedPoster(event.id)).poster_public_id, second)
      const [pending] = await cleanupRows(event.id)
      assert.equal(pending.public_id, first)
      assert.equal(pending.reason, 'detached')
      assert.equal(pending.attempts, 1)
      assert.equal(fake.assets.has(first), true, 'The old asset stays until a cleanup succeeds.')
      assert.ok(warnings.some((line) => line.includes('event_poster_cleanup_pending') && line.includes(first)))
      assert.equal(warnings.some((line) => /secret|cloudinary-test-key/i.test(line)), false, 'Warnings never include credentials or provider messages.')

      // A later sweep finishes the deletion once Cloudinary recovers; it is idempotent.
      fake.destroyError = null
      await ageCleanupRows(event.id)
      assert.deepEqual(await sweepPosterCleanups(), { attempted: 1, deleted: 1 })
      assert.equal(fake.assets.has(first), false)
      assert.equal(fake.assets.has(second), true)
      assert.deepEqual(await cleanupRows(event.id), [])
      assert.deepEqual(await sweepPosterCleanups(), { attempted: 0, deleted: 0 })
      fake.reset()
    })

    await t.test('a Cloudinary outage does not make poster requests retry every overdue cleanup', async () => {
      fake.reset()
      const event = await createEventThroughApi(admin)
      let current = (await uploadPoster(admin, event.id)).payload.data.poster_public_id
      fake.destroyError = Object.assign(new Error('Cloudinary unavailable'), { http_code: 500 })
      // Build up three overdue cleanups while Cloudinary cannot delete anything.
      for (let index = 0; index < 3; index += 1) {
        current = (await uploadPoster(admin, event.id, { expected: current })).payload.data.poster_public_id
      }
      await ageCleanupRows(event.id)
      assert.equal((await cleanupRows(event.id)).length, 3)

      // The replaced poster's deletion fails, so this request skips the sweep entirely.
      fake.destroys = []
      const removal = await removePoster(admin, event.id, current)
      assert.equal(removal.response.status, 200)
      assert.deepEqual(fake.destroys, [current])
      assert.deepEqual(await storedPoster(event.id), { poster_public_id: null, poster_url: null })

      // With nothing to replace, the request sweep stops at the first failure.
      fake.destroys = []
      assert.equal((await removePoster(admin, event.id, 'none')).response.status, 200)
      assert.equal(fake.destroys.length, 1)
      assert.equal((await cleanupRows(event.id)).length, 4, 'Every undeleted asset stays recorded for a retry.')

      // Once Cloudinary recovers, a sweep (as run by npm run posters:cleanup) clears them all.
      fake.destroyError = null
      await ageCleanupRows(event.id)
      assert.deepEqual(await sweepPosterCleanups({ limit: 50 }), { attempted: 4, deleted: 4 })
      assert.deepEqual(await cleanupRows(event.id), [])
      assert.equal([...fake.assets.keys()].some((publicId) => publicId.includes(event.id)), false)
      fake.reset()
    })

    await t.test('Cloudinary failures leave the event on its previous poster', async () => {
      fake.reset()
      const event = await createEventThroughApi(admin)
      const current = (await uploadPoster(admin, event.id)).payload.data.poster_public_id
      const before = await storedPoster(event.id)
      fake.reset()

      fake.uploadError = Object.assign(new Error('timeout'), { http_code: 499 })
      const failed = await uploadPoster(admin, event.id, { expected: current })
      assert.equal(failed.response.status, 502)
      assert.deepEqual(await storedPoster(event.id), before)
      // A timed-out upload might still complete, so its reserved ID waits for the delayed sweep.
      const [pending] = await cleanupRows(event.id)
      assert.equal(pending.reason, 'pending_upload')
      assert.equal(pending.public_id, fake.uploads[0])
      assert.deepEqual(fake.destroys, [])

      fake.uploadError = Object.assign(new Error('Invalid image file'), { http_code: 400 })
      const rejected = await uploadPoster(admin, event.id, { expected: current })
      assert.equal(rejected.response.status, 422)
      assert.deepEqual(await storedPoster(event.id), before)

      fake.uploadError = null
      fake.transformResult = (result) => ({ ...result, public_id: 'someone-else/asset' })
      const unexpected = await uploadPoster(admin, event.id, { expected: current })
      assert.equal(unexpected.response.status, 502)
      assert.deepEqual(await storedPoster(event.id), before)
      assert.equal(fake.assets.has(fake.uploads[2]), false, 'An unverified upload is deleted straight away.')
      fake.transformResult = null

      await ageCleanupRows(event.id)
      const swept = await sweepPosterCleanups({ limit: 10 })
      assert.deepEqual(swept, { attempted: 2, deleted: 2 })
      assert.deepEqual(await cleanupRows(event.id), [])
      assert.equal(fake.assets.has(current), true, 'The attached poster is never swept.')
      assert.deepEqual(await storedPoster(event.id), before)
      fake.reset()
    })

    await t.test('database-side attach failures discard the new upload and keep the current poster', async () => {
      fake.reset()
      const event = await createEventThroughApi(admin)
      const current = (await uploadPoster(admin, event.id)).payload.data.poster_public_id
      const before = await storedPoster(event.id)
      fake.reset()

      // The upload outlives the attach window, so the delayed sweep may already own its
      // pending row: the attach transaction must refuse to point the event at that asset.
      fake.beforeUpload = async ({ public_id: publicId }) => {
        await prisma.$executeRaw`
          UPDATE event_poster_cleanups SET created_at = clock_timestamp() - interval '11 minutes'
          WHERE public_id = ${publicId}`
      }
      const failed = await uploadPoster(admin, event.id, { expected: current })
      assert.equal(failed.response.status, 503)
      assert.deepEqual(await storedPoster(event.id), before)
      assert.equal(fake.assets.has(fake.uploads[0]), false, 'The unattached upload is deleted.')
      assert.equal(fake.assets.has(current), true)
      assert.deepEqual(await cleanupRows(event.id), [])

      // A database failure after the event row was updated rolls the whole switch back,
      // including the detached-asset record, and the new upload is cleaned up.
      fake.beforeUpload = null
      posterHooks.beforeAttachCommit = async () => {
        throw Object.assign(new Error('simulated database failure'), { name: 'DatabaseFailure' })
      }
      try {
        const blocked = await uploadPoster(admin, event.id, { expected: current })
        assert.equal(blocked.response.status, 500)
        assert.equal(blocked.payload.message, 'An unexpected server error occurred.')
      } finally {
        posterHooks.beforeAttachCommit = null
      }
      assert.deepEqual(await storedPoster(event.id), before)
      assert.equal(fake.assets.has(fake.uploads[1]), false)
      assert.equal(fake.assets.has(current), true)
      assert.deepEqual(await cleanupRows(event.id), [])
      fake.reset()
    })

    await t.test('stale and concurrent poster changes never delete the attached asset', async () => {
      fake.reset()
      const event = await createEventThroughApi(admin)
      const first = (await uploadPoster(admin, event.id)).payload.data.poster_public_id
      const second = (await uploadPoster(admin, event.id, { expected: first })).payload.data.poster_public_id
      fake.reset()

      // A page loaded before the replacement still names the first poster.
      const staleRemoval = await removePoster(admin, event.id, first)
      assert.equal(staleRemoval.response.status, 409)
      const staleReplace = await uploadPoster(admin, event.id, { expected: first })
      assert.equal(staleReplace.response.status, 409)
      const staleFromDefault = await uploadPoster(admin, event.id, { expected: 'none' })
      assert.equal(staleFromDefault.response.status, 409)
      assert.deepEqual(fake.uploads, [], 'Stale requests fail before uploading.')
      assert.equal((await storedPoster(event.id)).poster_public_id, second)
      assert.equal(fake.assets.has(second), true)

      // The poster changes while this upload is in flight: the lock re-check rejects it.
      fake.beforeUpload = async () => {
        fake.beforeUpload = null
        const removal = await removePoster(admin, event.id, second)
        assert.equal(removal.response.status, 200)
      }
      const overtaken = await uploadPoster(admin, event.id, { expected: second })
      assert.equal(overtaken.response.status, 409)
      assert.deepEqual(await storedPoster(event.id), { poster_public_id: null, poster_url: null })
      assert.equal(fake.assets.has(fake.uploads[0]), false, 'The overtaken upload is discarded.')
      assert.deepEqual(await cleanupRows(event.id), [])
      fake.reset()

      // Two admins upload at once from the same default poster: exactly one wins.
      const bothUploading = makeBarrier(2)
      fake.beforeUpload = bothUploading
      const racing = await Promise.all([uploadPoster(admin, event.id), uploadPoster(admin, event.id, { image: JPEG, contentType: 'image/jpeg' })])
      fake.beforeUpload = null
      assert.deepEqual(racing.map(({ response }) => response.status).sort(), [200, 409])
      const winner = racing.find(({ response }) => response.status === 200).payload.data.poster_public_id
      const loser = fake.uploads.find((publicId) => publicId !== winner)
      assert.equal((await storedPoster(event.id)).poster_public_id, winner)
      assert.equal(fake.assets.has(winner), true)
      assert.equal(fake.assets.has(loser), false)
      assert.deepEqual(await cleanupRows(event.id), [])
      fake.reset()

      // A removal and a replacement race from the same poster: whichever commits
      // first wins, and the attached poster (if any) still exists in Cloudinary.
      const bothStarted = makeBarrier(2)
      fake.beforeUpload = bothStarted
      const [replacement, removal] = await Promise.all([
        uploadPoster(admin, event.id, { image: WEBP, contentType: 'image/webp', expected: winner }),
        bothStarted().then(() => removePoster(admin, event.id, winner)),
      ])
      fake.beforeUpload = null
      assert.deepEqual([replacement.response.status, removal.response.status].sort(), [200, 409])
      const final = await storedPoster(event.id)
      assert.equal(fake.assets.has(winner), false, 'The poster both requests replaced is deleted.')
      if (final.poster_public_id) {
        assert.equal(replacement.response.status, 200)
        assert.equal(fake.assets.has(final.poster_public_id), true)
      } else {
        assert.equal(removal.response.status, 200)
        assert.equal(fake.assets.size > 0 && [...fake.assets.keys()].some((id) => id.includes(event.id)), false)
      }
      assert.deepEqual(await cleanupRows(event.id), [])

      // A stray cleanup row for the attached poster is dropped without deleting the asset.
      if (final.poster_public_id) {
        await prisma.event_poster_cleanups.create({ data: { public_id: final.poster_public_id, event_id: event.id, reason: 'detached' } })
        await ageCleanupRows(event.id)
        fake.reset()
        await sweepPosterCleanups()
        assert.deepEqual(fake.destroys, [])
        assert.equal(fake.assets.has(final.poster_public_id), true)
        assert.deepEqual(await cleanupRows(event.id), [])
      }
      fake.reset()
    })

    await t.test('poster changes leave ticket types, inventory, reservations, and bookings unchanged', async () => {
      fake.reset()
      const event = await createEventThroughApi(admin)
      await prisma.events.update({ where: { id: event.id }, data: { status: 'published' } })
      const ticketType = await request(`/api/admin/events/${event.id}/ticket-types`, {
        method: 'POST', cookie: admin.cookie, body: { name: `General ${randomUUID()}`, price: '450.00', total_quantity: 10 },
      })
      assert.equal(ticketType.response.status, 201)
      fixture.ticketTypeIds.push(ticketType.payload.data.id)

      const reservation = await request('/api/reservations', {
        method: 'POST', cookie: customer.cookie, body: { event_id: event.id, ticket_type_id: ticketType.payload.data.id, quantity: 2 },
      })
      assert.equal(reservation.response.status, 201)
      fixture.reservationIds.push(reservation.payload.data.reservation.id)
      const booked = await request('/api/reservations', {
        method: 'POST', cookie: customer.cookie, body: { event_id: event.id, ticket_type_id: ticketType.payload.data.id, quantity: 1 },
      })
      fixture.reservationIds.push(booked.payload.data.reservation.id)
      const checkout = await request(`/api/reservations/${booked.payload.data.reservation.id}/checkout`, {
        method: 'POST', cookie: customer.cookie, headers: { 'Idempotency-Key': randomUUID() },
      })
      assert.equal(checkout.response.status, 201)

      async function ticketingSnapshot() {
        const [ticketTypes, reservations, items, bookings, eventRow] = await Promise.all([
          prisma.ticket_types.findMany({ where: { event_id: event.id }, orderBy: { id: 'asc' } }),
          prisma.reservations.findMany({ where: { id: { in: fixture.reservationIds } }, orderBy: { id: 'asc' } }),
          prisma.reservation_items.findMany({ where: { reservation_id: { in: fixture.reservationIds } }, orderBy: { id: 'asc' } }),
          prisma.bookings.findMany({ where: { reservation_id: { in: fixture.reservationIds } }, orderBy: { id: 'asc' } }),
          prisma.events.findUnique({ where: { id: event.id }, select: { title: true, venue: true, description: true, starts_at: true, status: true } }),
        ])
        return JSON.stringify({ ticketTypes, reservations, items, bookings, eventRow })
      }
      const before = await ticketingSnapshot()

      const uploaded = await uploadPoster(admin, event.id)
      assert.equal(uploaded.response.status, 200)
      const replaced = await uploadPoster(admin, event.id, { image: JPEG, contentType: 'image/jpeg', expected: uploaded.payload.data.poster_public_id })
      assert.equal(replaced.response.status, 200)
      assert.equal((await removePoster(admin, event.id, replaced.payload.data.poster_public_id)).response.status, 200)
      fake.uploadError = new Error('network down')
      assert.equal((await uploadPoster(admin, event.id)).response.status, 502)
      fake.reset()

      assert.equal(await ticketingSnapshot(), before)
      const details = await request(`/api/events/${event.id}`)
      assert.equal(details.response.status, 200)
      assert.equal(details.payload.data.ticket_types[0].available_quantity, 7)
      assert.equal(details.payload.data.poster_url, null)
    })

    await t.test('database constraints keep poster references consistent', async () => {
      fake.reset()
      const event = await createEventThroughApi(admin)
      async function rejects(operation, code) {
        await assert.rejects(operation, (error) => JSON.stringify(error).includes(code) || String(error.message).includes(code))
      }
      // A URL without a public ID (or the reverse) is never stored.
      await rejects(prisma.$executeRaw`UPDATE events SET poster_url = 'https://example.test/a.png' WHERE id = ${event.id}::uuid`, '23514')
      await rejects(prisma.$executeRaw`UPDATE events SET poster_public_id = 'a/b' WHERE id = ${event.id}::uuid`, '23514')
      await rejects(prisma.$executeRaw`INSERT INTO event_poster_cleanups (public_id, event_id, reason) VALUES ('x/y', ${event.id}::uuid, 'other')`, '23514')
      assert.deepEqual(await storedPoster(event.id), { poster_public_id: null, poster_url: null })
    })
  } finally {
    posterHooks.beforeAttachCommit = null
    setGatewayForTests(null)
    if (fixture.server) await new Promise((resolve) => fixture.server.close(resolve))
    if (databaseReady) {
      const discoveredUsers = fixture.emails.length
        ? await prisma.users.findMany({ where: { email: { in: fixture.emails } }, select: { id: true } })
        : []
      const userIds = [...new Set([...fixture.userIds, ...discoveredUsers.map((user) => user.id)])]
      const ownedReservations = userIds.length
        ? await prisma.reservations.findMany({ where: { user_id: { in: userIds } }, select: { id: true } })
        : []
      const reservationIds = [...new Set([...fixture.reservationIds, ...ownedReservations.map((reservation) => reservation.id)])]

      if (reservationIds.length) {
        await prisma.bookings.deleteMany({ where: { reservation_id: { in: reservationIds } } })
        await prisma.reservation_items.deleteMany({ where: { reservation_id: { in: reservationIds } } })
        await prisma.reservations.deleteMany({ where: { id: { in: reservationIds } } })
      }
      if (userIds.length) await prisma.idempotency_keys.deleteMany({ where: { user_id: { in: userIds } } })
      if (fixture.eventIds.length) {
        await prisma.event_poster_cleanups.deleteMany({ where: { event_id: { in: fixture.eventIds } } })
        await prisma.ticket_types.deleteMany({ where: { event_id: { in: fixture.eventIds } } })
        await prisma.events.deleteMany({ where: { id: { in: fixture.eventIds } } })
      }
      if (userIds.length) await prisma.users.deleteMany({ where: { id: { in: userIds } } })
    }
    await disconnectPrisma()
  }
})
