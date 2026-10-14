const test = require('node:test')
const assert = require('node:assert/strict')
const errorMiddleware = require('../../server/src/middleware/errorMiddleware')

function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
}

test('unexpected errors return a generic message without leaking internal details', () => {
  const response = responseRecorder()
  errorMiddleware(new Error('sensitive internal detail'), {}, response, () => {})
  assert.equal(response.statusCode, 500)
  assert.deepEqual(response.payload, { success: false, message: 'An unexpected server error occurred.' })
})

test('application errors preserve their intended status and message', () => {
  const response = responseRecorder()
  errorMiddleware({ statusCode: 409, message: 'This reservation is no longer available.' }, {}, response, () => {})
  assert.equal(response.statusCode, 409)
  assert.equal(response.payload.message, 'This reservation is no longer available.')
})
