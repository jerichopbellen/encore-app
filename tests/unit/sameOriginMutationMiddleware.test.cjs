const assert = require('node:assert/strict')
const http = require('node:http')
const test = require('node:test')
const app = require('../../server/src/app')

test('API mutation routes reject untrusted browser origins before handlers run', async () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalFrontendOrigin = process.env.FRONTEND_ORIGIN
  process.env.NODE_ENV = 'test'
  process.env.FRONTEND_ORIGIN = 'http://localhost:5173'
  const server = app.listen(0, '127.0.0.1')

  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })
    const baseUrl = `http://127.0.0.1:${server.address().port}`

    const blockedResponse = await fetch(`${baseUrl}/api/reservations/00000000-0000-4000-8000-000000000001/cancel`, {
      method: 'POST',
      headers: { Origin: 'https://untrusted.example' },
    })
    assert.equal(blockedResponse.status, 403)
    assert.deepEqual(await blockedResponse.json(), {
      success: false,
      message: 'This request origin is not allowed.',
    })

    const trustedResponse = await fetch(`${baseUrl}/api/reservations/00000000-0000-4000-8000-000000000001/cancel`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:5173' },
    })
    assert.equal(trustedResponse.status, 401)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
    if (originalFrontendOrigin === undefined) delete process.env.FRONTEND_ORIGIN
    else process.env.FRONTEND_ORIGIN = originalFrontendOrigin
  }
})
