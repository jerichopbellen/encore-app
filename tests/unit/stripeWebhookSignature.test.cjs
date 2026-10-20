const test = require('node:test')
const assert = require('node:assert/strict')
const Stripe = require('../../server/node_modules/stripe')
const express = require('../../server/node_modules/express')

const WEBHOOK_SECRET = 'whsec_unit_test_signature_secret'
process.env.PAYMENT_PROVIDER = 'stripe'
process.env.STRIPE_SECRET_KEY = 'sk_test_unit_test_placeholder'
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
process.env.FRONTEND_ORIGIN = 'http://localhost:5173'

const stripeGateway = require('../../server/src/services/stripeGateway')
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const payload = JSON.stringify({ id: 'evt_unit', object: 'event', type: 'checkout.session.completed', created: 1, data: { object: {} } })
function sign(body, { secret = WEBHOOK_SECRET, timestamp } = {}) {
  return stripe.webhooks.generateTestHeaderString({ payload: body, secret, timestamp })
}

test('a correctly signed raw body is accepted', () => {
  const event = stripeGateway.constructEvent(Buffer.from(payload), sign(payload))
  assert.equal(event.id, 'evt_unit')
})

test('tampered, wrong-secret, stale, and missing signatures are rejected', () => {
  assert.throws(() => stripeGateway.constructEvent(Buffer.from(`${payload} `), sign(payload)))
  assert.throws(() => stripeGateway.constructEvent(Buffer.from(payload), sign(payload, { secret: 'whsec_other_secret' })))
  const staleSeconds = Math.floor(Date.now() / 1000) - 3600
  assert.throws(() => stripeGateway.constructEvent(Buffer.from(payload), sign(payload, { timestamp: staleSeconds })))
  assert.throws(() => stripeGateway.constructEvent(Buffer.from(payload), undefined))
})

test('a re-serialized body no longer matches the signature, so the route needs the raw bytes', () => {
  const pretty = JSON.stringify(JSON.parse(payload), null, 2)
  assert.throws(() => stripeGateway.constructEvent(Buffer.from(pretty), sign(payload)))
})

test('the webhook route receives the unparsed request body', async () => {
  // Mirrors the production mounting order: express.raw before express.json.
  const app = express()
  let received
  app.post('/hook', express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
    received = req.body
    res.status(200).end()
  })
  app.use(express.json())
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    })
    assert.equal(response.status, 200)
    assert.equal(Buffer.isBuffer(received), true)
    assert.equal(received.toString('utf8'), payload)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
