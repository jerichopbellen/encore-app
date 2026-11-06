// Shared body of the real-app regression tests that prove IP-based rate limiting stays OFF while
// account-keyed limiting stays ON. A thin test file sets NODE_ENV and TRUST_PROXY_HOPS FIRST (the
// limiters read the environment when the app is loaded), then calls defineIpLimitingDisabledTests.
//
// No database is touched: the service functions that would query PostgreSQL are replaced before the
// app is loaded, and DATABASE_URL is blanked so nothing can connect.
const assert = require('node:assert/strict')
const test = require('node:test')
const { serverRequire, withServer, send } = require('./listen.cjs')

function defineIpLimitingDisabledTests(label) {
  Object.assign(process.env, {
    DATABASE_URL: '',
    JWT_SECRET: 'unit-test-secret-that-is-at-least-32-bytes-long',
    FRONTEND_ORIGIN: 'https://encore.example.com',
    PAYMENT_PROVIDER: 'simulated',
    // Deliberately tiny limits: if any IP-keyed limiter were active, these requests would hit 429.
    RATE_LIMIT_LOGIN_IP_MAX: '2',
    RATE_LIMIT_REGISTRATION_MAX: '1',
    RATE_LIMIT_RESERVATION_IP_MAX: '1',
    RATE_LIMIT_GENERAL_READ_MAX: '3',
    RATE_LIMIT_LOGIN_FAILURE_MAX: '1',
    RATE_LIMIT_LOGIN_FAILURE_NO_IP_MAX: '3',
    RATE_LIMIT_RESERVATION_CREATION_MAX: '2',
    RATE_LIMIT_RESERVATION_CANCEL_MAX: '2',
    RATE_LIMIT_RESERVATION_READ_MAX: '3',
    RATE_LIMIT_PAYMENT_INITIATION_MAX: '2',
  })
  console.log = () => {} // request logging in non-test environments
  console.warn = () => {} // rate_limited log lines

  const bcrypt = serverRequire('bcrypt')
  const jwt = serverRequire('jsonwebtoken')
  const authService = require('../../server/src/services/authService')
  const reservationService = require('../../server/src/services/reservationService')
  const paymentService = require('../../server/src/services/paymentService')

  const PASSWORD = 'correct-password'
  const passwordHash = bcrypt.hashSync(PASSWORD, 4)
  authService.findSafeUserById = async (id) => ({ id, name: 'Test', email: `${id}@example.com`, role: 'customer', created_at: new Date() })
  authService.findUserByEmail = async (email) => (email === 'member@example.com'
    ? { id: 'member-id', name: 'Member', email, role: 'customer', password_hash: passwordHash, created_at: new Date() }
    : null)
  authService.registerUser = async () => ({ id: 'new-user' })
  reservationService.createReservation = async () => ({ id: 'reservation' })
  reservationService.cancelReservation = async () => ({ outcome: 'not-found' })
  reservationService.listReservations = async () => []
  paymentService.startPayment = async () => ({ payment: { id: 'payment' }, created: true })

  const app = require('../../server/src/app')
  const { rateLimiters } = require('../../server/src/middleware/rateLimiters')

  const ID = '00000000-0000-4000-8000-000000000001'
  const cookieFor = (userId) => ({
    Cookie: `encore_session=${jwt.sign({}, process.env.JWT_SECRET, { algorithm: 'HS256', subject: userId, issuer: 'encore-api', audience: 'encore-client', expiresIn: '1h' })}`,
  })

  async function scenario(run) {
    await rateLimiters.resetAll()
    try {
      await withServer(app, run)
    } finally {
      await rateLimiters.resetAll()
    }
  }

  test(`[${label}] Express is not told to trust any proxy`, () => {
    assert.equal(app.get('trust proxy'), false)
  })

  test(`[${label}] the IP-keyed limiters are inactive`, async () => {
    await scenario(async (base) => {
      // generalRead (3), loginIp (2) and registration (1) would all have tripped by now.
      for (let i = 0; i < 8; i += 1) assert.equal((await send(base, 'GET', '/api/payments/config')).status, 200)
      for (let i = 0; i < 6; i += 1) assert.equal((await send(base, 'POST', '/api/auth/login', { json: {} })).status, 400)
      const body = { name: 'New User', email: 'new@example.com', password: 'long-enough-password' }
      for (let i = 0; i < 4; i += 1) assert.equal((await send(base, 'POST', '/api/auth/register', { json: body })).status, 201)
      // A forged X-Forwarded-For can neither trigger nor evade anything: it is not used.
      for (let i = 0; i < 4; i += 1) {
        assert.equal((await send(base, 'GET', '/api/payments/config', { headers: { 'X-Forwarded-For': `9.9.9.${i}` } })).status, 200)
      }
    })
  })

  test(`[${label}] account-keyed reservation limits stay active and the per-IP backstop stays inactive`, async () => {
    await scenario(async (base) => {
      const create = (user) => send(base, 'POST', '/api/reservations', { headers: cookieFor(user), json: { event_id: ID, ticket_type_id: ID, quantity: 1 } })
      // reservationIp is 1, yet three different accounts reserve from the same address.
      for (const user of ['user-a', 'user-b', 'user-c']) assert.equal((await create(user)).status, 201)
      assert.equal((await create('user-a')).status, 201)
      const limited = await create('user-a') // third success for user-a: reservationCreation (2) is spent
      assert.equal(limited.status, 429)
      assert.equal(limited.body.success, false)
      assert.ok(Number(limited.headers.get('retry-after')) >= 1)
      // Another account is independent.
      assert.equal((await create('user-d')).status, 201)
    })
  })

  test(`[${label}] account-keyed cancellation, payment and read limits stay active`, async () => {
    await scenario(async (base) => {
      // Unauthenticated requests are rejected by authentication before any limiter.
      assert.equal((await send(base, 'GET', '/api/reservations')).status, 401)

      const headers = { ...cookieFor('user-a'), 'Idempotency-Key': 'unit-test-key-0001' }
      const other = { ...cookieFor('user-b'), 'Idempotency-Key': 'unit-test-key-0002' }
      const cancel = (h) => send(base, 'POST', `/api/reservations/${ID}/cancel`, { headers: h, json: {} })
      const pay = (h) => send(base, 'POST', `/api/reservations/${ID}/payments`, { headers: h, json: {} })
      const read = (h) => send(base, 'GET', '/api/reservations', { headers: h })

      // reservationCancel (2): every attempt counts, including these 404s.
      assert.equal((await cancel(headers)).status, 404)
      assert.equal((await cancel(headers)).status, 404)
      assert.equal((await cancel(headers)).status, 429)
      assert.equal((await cancel(other)).status, 404)

      // paymentInitiation (2).
      assert.equal((await pay(headers)).status, 201)
      assert.equal((await pay(headers)).status, 201)
      assert.equal((await pay(headers)).status, 429)
      assert.equal((await pay(other)).status, 201)

      // reservationRead (3): this 429 comes from the account limiter; the general IP limiter is off.
      for (let i = 0; i < 3; i += 1) assert.equal((await read(headers)).status, 200)
      assert.equal((await read(headers)).status, 429)
      assert.equal((await read(other)).status, 200)
    })
  })

  test(`[${label}] login failures use the per-email fallback, shared across any forwarded address`, async () => {
    await scenario(async (base) => {
      const attempt = (email, ip) => send(base, 'POST', '/api/auth/login', { headers: { 'X-Forwarded-For': ip }, json: { email, password: 'wrong' } })
      assert.equal((await attempt('member@example.com', '1.1.1.1')).status, 401)
      assert.equal((await attempt('member@example.com', '2.2.2.2')).status, 401)
      assert.equal((await attempt('member@example.com', '3.3.3.3')).status, 401)
      const registered = await attempt('member@example.com', '4.4.4.4')
      assert.equal(registered.status, 429)
      assert.ok(Number(registered.headers.get('retry-after')) >= 1)

      for (let i = 0; i < 3; i += 1) await attempt('nobody@example.com', `5.5.5.${i}`)
      const unknown = await attempt('nobody@example.com', '6.6.6.6')
      assert.equal(unknown.status, 429)
      assert.deepEqual(unknown.body, registered.body) // identical for registered and unknown emails
    })
  })

  test(`[${label}] health and the Stripe webhook remain reachable`, async () => {
    await scenario(async (base) => {
      for (let i = 0; i < 6; i += 1) {
        assert.equal((await send(base, 'GET', '/api/health')).status, 200)
        assert.equal((await send(base, 'POST', '/api/payments/stripe/webhook', { json: {} })).status, 404)
      }
    })
  })
}

module.exports = { defineIpLimitingDisabledTests }
