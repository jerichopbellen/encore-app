const test = require('node:test')
const assert = require('node:assert/strict')
const { corsMiddleware } = require('../../server/src/middleware/corsMiddleware')

function responseRecorder() {
  return {
    headers: {}, statusCode: null, ended: false, payload: null,
    vary(value) { this.headers.Vary = value },
    set(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
    end() { this.ended = true; return this },
  }
}

function request(method, headers = {}) {
  return { method, get(name) { return headers[name.toLowerCase()] } }
}

test('CORS allows only the configured origin and credentials', () => {
  const response = responseRecorder()
  let continued = false
  corsMiddleware(request('GET', { origin: 'http://localhost:5173' }), response, () => { continued = true })
  assert.equal(continued, true)
  assert.equal(response.headers['Access-Control-Allow-Origin'], 'http://localhost:5173')
  assert.equal(response.headers['Access-Control-Allow-Credentials'], 'true')
  assert.equal(response.headers.Vary, 'Origin')
})

test('disallowed origins receive no permissive CORS headers', () => {
  const response = responseRecorder()
  let continued = false
  corsMiddleware(request('GET', { origin: 'https://attacker.invalid' }), response, () => { continued = true })
  assert.equal(continued, true)
  assert.equal(response.headers['Access-Control-Allow-Origin'], undefined)
  assert.equal(response.headers['Access-Control-Allow-Credentials'], undefined)
})

test('preflight accepts the checkout header and rejects unsupported headers and origins', () => {
  const allowed = responseRecorder()
  corsMiddleware(request('OPTIONS', {
    origin: 'http://localhost:5173',
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'content-type, idempotency-key',
  }), allowed, () => assert.fail('Allowed preflight should finish the response'))
  assert.equal(allowed.statusCode, 204)
  assert.match(allowed.headers['Access-Control-Allow-Headers'], /Idempotency-Key/)
  assert.match(allowed.headers['Access-Control-Allow-Methods'], /PATCH/)

  const badHeader = responseRecorder()
  corsMiddleware(request('OPTIONS', {
    origin: 'http://localhost:5173',
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'authorization',
  }), badHeader, () => assert.fail('Unsupported header should be rejected'))
  assert.equal(badHeader.statusCode, 403)

  const badOrigin = responseRecorder()
  corsMiddleware(request('OPTIONS', { origin: 'https://attacker.invalid' }), badOrigin, () => assert.fail('Bad origin should be rejected'))
  assert.equal(badOrigin.statusCode, 403)
  assert.equal(badOrigin.headers['Access-Control-Allow-Origin'], undefined)
})
