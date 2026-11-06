// The real app loaded exactly as production loads it before the proxy chain is verified:
// NODE_ENV=production and TRUST_PROXY_HOPS unset. IP-based limiters must be inactive, account-based
// limiters must stay active, and the email-only login fallback must apply. No database is touched
// (services are stubbed, DATABASE_URL is blank) and no secret is read: the values below are test-only.
const assert = require('node:assert/strict')
const test = require('node:test')
const { serverRequire, withServer, send } = require('../helpers/listen.cjs')

Object.assign(process.env, {
  NODE_ENV: 'production',
  DATABASE_URL: '',
  JWT_SECRET: 'unit-test-secret-that-is-at-least-32-bytes-long',
  FRONTEND_ORIGIN: 'https://encore.example.com',
  PAYMENT_PROVIDER: 'simulated',
  TRUST_PROXY_HOPS: '',
  RATE_LIMIT_LOGIN_IP_MAX: '2',
  RATE_LIMIT_REGISTRATION_MAX: '1',
  RATE_LIMIT_RESERVATION_IP_MAX: '1',
  RATE_LIMIT_GENERAL_READ_MAX: '3',
  RATE_LIMIT_LOGIN_FAILURE_NO_IP_MAX: '3',
  RATE_LIMIT_LOGIN_FAILURE_MAX: '1',
  RATE_LIMIT_RESERVATION_CREATION_MAX: '2',
})
console.log = () => {} // production request logging
console.warn = () => {}

const bcrypt = serverRequire('bcrypt')
const jwt = serverRequire('jsonwebtoken')
const authService = require('../../server/src/services/authService')
const reservationService = require('../../server/src/services/reservationService')

const PASSWORD = 'correct-password'
const passwordHash = bcrypt.hashSync(PASSWORD, 4)
authService.findSafeUserById = async (id) => ({ id, name: 'Test', email: `${id}@example.com`, role: 'customer', created_at: new Date() })
authService.findUserByEmail = async (email) => (email === 'member@example.com'
  ? { id: 'member-id', name: 'Member', email, role: 'customer', password_hash: passwordHash, created_at: new Date() }
  : null)
authService.registerUser = async () => ({ id: 'new-user' })
reservationService.createReservation = async () => ({ id: 'reservation' })

const app = require('../../server/src/app')
const { rateLimiters } = require('../../server/src/middleware/rateLimiters')

const ID = '00000000-0000-4000-8000-000000000001'
const origin = 'https://encore.example.com'
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

test('production with unset proxy hops does not trust any proxy', () => {
  assert.equal(app.get('trust proxy'), false)
})

test('IP-based limiters are inactive in production while the proxy chain is unverified', async () => {
  await scenario(async (base) => {
    // generalRead (3), loginIp (2) and registration (1) would all have tripped by now.
    for (let i = 0; i < 8; i += 1) assert.equal((await send(base, 'GET', '/api/payments/config')).status, 200)
    for (let i = 0; i < 6; i += 1) assert.equal((await send(base, 'POST', '/api/auth/login', { json: {} })).status, 400)
    const body = { name: 'New User', email: 'new@example.com', password: 'long-enough-password' }
    for (let i = 0; i < 4; i += 1) assert.equal((await send(base, 'POST', '/api/auth/register', { json: body, headers: { Origin: origin } })).status, 201)
    // A forged X-Forwarded-For changes nothing: it is not trusted and not used.
    for (let i = 0; i < 4; i += 1) assert.equal((await send(base, 'GET', '/api/payments/config', { headers: { 'X-Forwarded-For': `9.9.9.${i}` } })).status, 200)
  })
})

test('the reservation IP backstop is inactive but the account limiters stay active in production', async () => {
  await scenario(async (base) => {
    const create = (user) => send(base, 'POST', '/api/reservations', { headers: cookieFor(user), json: { event_id: ID, ticket_type_id: ID, quantity: 1 } })
    // reservationIp is 1, yet three different accounts create reservations from the same address.
    for (const user of ['user-a', 'user-b', 'user-c']) assert.equal((await create(user)).status, 201)
    assert.equal((await create('user-a')).status, 201)
    const limited = await create('user-a')
    assert.equal(limited.status, 429)
    assert.equal(limited.body.success, false)
    assert.ok(Number(limited.headers.get('retry-after')) >= 1)
  })
})

test('login failures use the email-only fallback threshold in production, with one generic 429', async () => {
  await scenario(async (base) => {
    // loginFailure (email+IP) is 1 here; the fallback is 3. Different forwarded IPs share one counter.
    const attempt = (email, ip) => send(base, 'POST', '/api/auth/login', { headers: { 'X-Forwarded-For': ip }, json: { email, password: 'wrong' } })
    assert.equal((await attempt('member@example.com', '1.1.1.1')).status, 401)
    assert.equal((await attempt('member@example.com', '2.2.2.2')).status, 401)
    assert.equal((await attempt('member@example.com', '3.3.3.3')).status, 401)
    const registered = await attempt('member@example.com', '4.4.4.4')
    assert.equal(registered.status, 429)

    for (let i = 0; i < 3; i += 1) await attempt('nobody@example.com', `5.5.5.${i}`)
    const unknown = await attempt('nobody@example.com', '6.6.6.6')
    assert.equal(unknown.status, 429)
    assert.deepEqual(unknown.body, registered.body)

    // Successful logins for other accounts are unaffected.
    const ok = await send(base, 'POST', '/api/auth/login', { json: { email: 'member@example.com', password: PASSWORD } })
    assert.equal(ok.status, 429, 'the locked email stays locked, even for the correct password')
  })
})

test('health, readiness and the webhook remain reachable in production', async () => {
  await scenario(async (base) => {
    for (let i = 0; i < 6; i += 1) {
      assert.equal((await send(base, 'GET', '/api/health')).status, 200)
      assert.equal((await send(base, 'GET', '/api/ready')).status, 503)
      assert.equal((await send(base, 'POST', '/api/payments/stripe/webhook', { json: {} })).status, 404)
    }
  })
})
