const test = require('node:test')
const assert = require('node:assert/strict')
const { createReadinessHandler } = require('../../server/src/controllers/readinessController')

function responseRecorder() {
  return {
    statusCode: null, payload: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
}

test('readiness returns success after a lightweight database query', async () => {
  const handler = createReadinessHandler(async () => ({ $queryRaw: () => Promise.resolve([{ '?column?': 1 }]) }))
  const response = responseRecorder()
  await handler({}, response)
  assert.equal(response.statusCode, 200)
  assert.equal(response.payload.success, true)
})

test('readiness returns a generic unavailable response on query failure', async () => {
  const handler = createReadinessHandler(async () => ({ $queryRaw: () => Promise.reject(new Error('secret database detail')) }))
  const response = responseRecorder()
  await handler({}, response)
  assert.equal(response.statusCode, 503)
  assert.deepEqual(response.payload, { success: false, message: 'Encore database readiness check failed.' })
  assert.doesNotMatch(JSON.stringify(response.payload), /secret database detail/)
})
