const test = require('node:test')
const assert = require('node:assert/strict')
const { getPosterConfig, validatePosterEnvironment } = require('../../server/src/config/posters')
const { validateEnvironment } = require('../../server/src/config/environment')
const {
  detectImageType,
  validatePosterUpload,
  normalizeExpectedPoster,
} = require('../../server/src/validators/posterValidator')
const { readPosterUpload } = require('../../server/src/middleware/posterUploadMiddleware')
const { buildPosterUrl } = require('../../server/src/services/eventPosterService')
const { serializeEvent, serializeAdminEvent } = require('../../server/src/utils/eventSerializer')
const { corsMiddleware } = require('../../server/src/middleware/corsMiddleware')

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(16)])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')
const CLOUDINARY = { CLOUDINARY_CLOUD_NAME: 'encore-demo', CLOUDINARY_API_KEY: 'key', CLOUDINARY_API_SECRET: 'secret' }

test('poster images are identified by their content, not their declared type', () => {
  assert.equal(detectImageType(PNG), 'image/png')
  assert.equal(detectImageType(JPEG), 'image/jpeg')
  assert.equal(detectImageType(WEBP), 'image/webp')
  for (const content of [SVG, Buffer.from('GIF89a........'), Buffer.from('%PDF-1.7'), Buffer.from('<html></html>'), PNG.subarray(0, 10)]) {
    assert.equal(detectImageType(content), null)
  }

  assert.equal(validatePosterUpload(PNG, 'image/png'), 'image/png')
  assert.equal(validatePosterUpload(JPEG, 'image/jpeg; charset=binary'), 'image/jpeg')
  assert.throws(() => validatePosterUpload(SVG, 'image/png'), (error) => error.statusCode === 415)
  assert.throws(() => validatePosterUpload(PNG, 'image/jpeg'), (error) => error.statusCode === 415 && /does not match/.test(error.message))
  assert.throws(() => validatePosterUpload(Buffer.alloc(0), 'image/png'), (error) => error.statusCode === 400)
  assert.throws(() => validatePosterUpload(undefined, 'image/png'), (error) => error.statusCode === 400)
})

test('the expected_poster precondition is required and well formed', () => {
  assert.equal(normalizeExpectedPoster('none'), null)
  assert.equal(normalizeExpectedPoster('encore/event-posters/abc/def-123'), 'encore/event-posters/abc/def-123')
  for (const value of [undefined, '', ['none', 'none'], 'https://res.cloudinary.com/x/image/upload/a.png', '../secret', 'a//b', 'x'.repeat(256)]) {
    assert.throws(() => normalizeExpectedPoster(value), (error) => error.statusCode === 400)
  }
})

test('poster configuration is optional, all-or-nothing, and bounded', () => {
  assert.equal(getPosterConfig({}).configured, false)
  assert.equal(getPosterConfig({}).maxBytes, 4 * 1024 * 1024)
  assert.equal(getPosterConfig({}).folder, 'encore/event-posters')
  assert.equal(getPosterConfig(CLOUDINARY).configured, true)
  assert.deepEqual(validatePosterEnvironment({}), { configured: false })
  assert.deepEqual(validatePosterEnvironment(CLOUDINARY), { configured: true })
  assert.equal(getPosterConfig({ POSTER_UPLOAD_MAX_BYTES: '2097152' }).maxBytes, 2097152)

  for (const missing of Object.keys(CLOUDINARY)) {
    const partial = { ...CLOUDINARY, [missing]: '' }
    assert.throws(() => validatePosterEnvironment(partial), /must be set together/)
    // Startup validation covers poster settings and never echoes their values.
    assert.throws(() => validateEnvironment({ NODE_ENV: 'development', ...partial }), (error) => !error.message.includes('secret'))
  }
  assert.throws(() => validatePosterEnvironment({ ...CLOUDINARY, CLOUDINARY_CLOUD_NAME: 'https://example.com' }), /cloud name/)
  for (const value of ['0', '1023', '10485761', '4MB', '-1', '1.5']) {
    assert.throws(() => getPosterConfig({ POSTER_UPLOAD_MAX_BYTES: value }), /POSTER_UPLOAD_MAX_BYTES/)
  }
  for (const folder of ['../up', 'a//b', '/lead', 'trail/', 'sp ace']) {
    assert.throws(() => getPosterConfig({ CLOUDINARY_POSTER_FOLDER: folder }), /CLOUDINARY_POSTER_FOLDER/)
  }
})

function runPosterUpload(headers, { eventId = '0b6f3a1e-7c1d-4c2a-9a55-3f1d2e4b5c6d', expected = 'none' } = {}) {
  const req = {
    params: { eventId },
    // expected: null omits the precondition entirely.
    query: expected === null ? {} : { expected_poster: expected },
    headers: Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])),
    get(name) { return this.headers[name.toLowerCase()] },
    // Any attempt to read the body would subscribe to it; these tests must never reach that point.
    on() { throw new Error('The request body was read.') },
  }
  return new Promise((resolve) => {
    try {
      readPosterUpload(req, {}, (error) => resolve(error))
    } catch (error) {
      resolve(error)
    }
  })
}

test('poster upload middleware rejects unsupported types and oversized bodies before reading them', async () => {
  const previousLimit = process.env.POSTER_UPLOAD_MAX_BYTES
  process.env.POSTER_UPLOAD_MAX_BYTES = '2048'
  try {
    for (const contentType of [undefined, 'image/svg+xml', 'image/gif', 'text/html', 'application/json', 'multipart/form-data; boundary=x']) {
      const error = await runPosterUpload(contentType ? { 'Content-Type': contentType } : {})
      assert.equal(error.statusCode, 415, `${contentType} should be rejected`)
    }
    const tooLarge = await runPosterUpload({ 'Content-Type': 'image/png', 'Content-Length': '2049' })
    assert.equal(tooLarge.statusCode, 413)
    assert.match(tooLarge.message, /MB or smaller/)
    const malformedLength = await runPosterUpload({ 'Content-Type': 'image/png', 'Content-Length': '12abc' })
    assert.equal(malformedLength.statusCode, 400)

    // The event ID and precondition are checked before the body is read.
    const validHeaders = { 'Content-Type': 'image/png', 'Content-Length': '100' }
    const badEventId = await runPosterUpload(validHeaders, { eventId: 'not-a-uuid' })
    assert.equal(badEventId.statusCode, 400)
    assert.match(badEventId.message, /Event ID/)
    for (const expected of [null, '', 'https://res.cloudinary.com/x/image/upload/v1/a']) {
      const badPrecondition = await runPosterUpload(validHeaders, { expected })
      assert.equal(badPrecondition.statusCode, 400)
      assert.match(badPrecondition.message, /expected_poster/)
    }
  } finally {
    if (previousLimit === undefined) delete process.env.POSTER_UPLOAD_MAX_BYTES
    else process.env.POSTER_UPLOAD_MAX_BYTES = previousLimit
  }
})

test('poster URLs are built from verified Cloudinary data and serialized only when present', () => {
  assert.equal(
    buildPosterUrl('encore-demo', 1712345678, 'encore/event-posters/e1/p1'),
    'https://res.cloudinary.com/encore-demo/image/upload/c_limit,w_2000,f_auto,q_auto/v1712345678/encore/event-posters/e1/p1',
  )
  const event = {
    id: 'e1', title: 'Show', description: null, venue: 'Hall', starts_at: new Date('2030-01-01T00:00:00Z'), status: 'published', ticket_types: [],
  }
  assert.equal(serializeEvent(event).poster_url, null)
  assert.equal(serializeAdminEvent(event).poster_public_id, null)
  const withPoster = { ...event, poster_url: 'https://res.cloudinary.com/x/image/upload/v1/p', poster_public_id: 'p' }
  assert.equal(serializeEvent(withPoster).poster_url, withPoster.poster_url)
  // Public responses never include the admin-only replacement precondition.
  assert.equal(Object.hasOwn(serializeEvent(withPoster), 'poster_public_id'), false)
  assert.equal(serializeAdminEvent(withPoster).poster_public_id, 'p')
})

test('CORS preflight allows DELETE for poster removal from the configured origin', () => {
  const response = {
    headers: {}, statusCode: null,
    vary() {}, set(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this }, json() { return this }, end() { return this },
  }
  const headers = { origin: 'http://localhost:5173', 'access-control-request-method': 'DELETE' }
  corsMiddleware({ method: 'OPTIONS', get: (name) => headers[name.toLowerCase()] }, response, () => assert.fail('Preflight should finish'))
  assert.equal(response.statusCode, 204)
  assert.match(response.headers['Access-Control-Allow-Methods'], /DELETE/)
})
