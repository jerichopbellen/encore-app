// Proves TRUST_PROXY_HOPS really reaches the Express application that serves requests, and that
// the hop count (not the client) decides which X-Forwarded-For entry identifies a visitor.
// The value 2 below is a TEST value only; it says nothing about Encore's real proxy chain.
const assert = require('node:assert/strict')
const test = require('node:test')
const { withServer, send } = require('../helpers/listen.cjs')

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: '',
  PAYMENT_PROVIDER: 'simulated',
  TRUST_PROXY_HOPS: '2',
  RATE_LIMIT_GENERAL_READ_MAX: '1',
})
console.warn = () => {}

const app = require('../../server/src/app')
const { rateLimiters } = require('../../server/src/middleware/rateLimiters')

test('TRUST_PROXY_HOPS is applied to the Express app as a number, never as true', () => {
  assert.equal(app.get('trust proxy'), 2)
  assert.notEqual(app.get('trust proxy'), true)
})

test('with two trusted hops the third entry from the right identifies the client; forged leading entries are ignored', async () => {
  await rateLimiters.resetAll()
  try {
    await withServer(app, async (base) => {
      const get = (forwardedFor) => send(base, 'GET', '/api/payments/config', { headers: { 'X-Forwarded-For': forwardedFor } })
      // Entries to the right are added by the two trusted proxies; the left-most is client-controlled.
      assert.equal((await get('1.1.1.1, 203.0.113.5, 10.0.0.1')).status, 200)
      assert.equal((await get('2.2.2.2, 203.0.113.5, 10.0.0.1')).status, 429) // same client, forged prefix ignored
      assert.equal((await get('3.3.3.3, 203.0.113.99, 10.0.0.1')).status, 200) // a different real client
    })
  } finally {
    await rateLimiters.resetAll()
  }
})
