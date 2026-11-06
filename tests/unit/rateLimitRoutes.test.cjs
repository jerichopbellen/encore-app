// Exercises the REAL Express app and route files to prove each limiter is mounted on the
// right route and in the right order. No database is touched: the service functions that
// would query PostgreSQL are replaced before the app is loaded, DATABASE_URL is blanked so
// the readiness probe cannot connect, and the limits are lowered through the same
// RATE_LIMIT_* environment variables a deployment would use.
const assert = require('node:assert/strict')
const test = require('node:test')
const { serverRequire, withServer, send } = require('../helpers/listen.cjs')

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: '',
  JWT_SECRET: 'unit-test-secret-that-is-at-least-32-bytes-long',
  PAYMENT_PROVIDER: 'simulated',
  TRUST_PROXY_HOPS: '',
  RATE_LIMIT_LOGIN_IP_MAX: '10',
  RATE_LIMIT_LOGIN_FAILURE_MAX: '2',
  RATE_LIMIT_REGISTRATION_MAX: '2',
  RATE_LIMIT_RESERVATION_CREATION_MAX: '2',
  RATE_LIMIT_RESERVATION_ATTEMPT_MAX: '4',
  RATE_LIMIT_RESERVATION_IP_MAX: '3',
  RATE_LIMIT_RESERVATION_CANCEL_MAX: '2',
  RATE_LIMIT_RESERVATION_READ_MAX: '3',
  RATE_LIMIT_PAYMENT_INITIATION_MAX: '2',
  RATE_LIMIT_PAYMENT_CANCELLATION_MAX: '2',
  RATE_LIMIT_POSTER_MUTATION_MAX: '2',
  RATE_LIMIT_GENERAL_READ_MAX: '6',
})
console.warn = () => {} // rate_limited log lines are covered in rateLimitMiddleware.test.cjs

const bcrypt = serverRequire('bcrypt')
const jwt = serverRequire('jsonwebtoken')
const AppError = require('../../server/src/utils/AppError')
const authService = require('../../server/src/services/authService')
const reservationService = require('../../server/src/services/reservationService')
const bookingService = require('../../server/src/services/bookingService')
const paymentService = require('../../server/src/services/paymentService')
const eventPosterService = require('../../server/src/services/eventPosterService')

const PASSWORD = 'correct-password'
const passwordHash = bcrypt.hashSync(PASSWORD, 4)
const state = { reservationOutcome: 'created', calls: { createReservation: 0, startPayment: 0, cancelReservation: 0, posterUpload: 0 } }

// Replaced before the app (and its destructured imports) loads.
authService.findSafeUserById = async (id) => ({
  id, name: 'Test', email: `${id}@example.com`, role: id.startsWith('admin') ? 'admin' : 'customer', created_at: new Date(),
})
authService.findUserByEmail = async (email) => (email === 'member@example.com'
  ? { id: 'member-id', name: 'Member', email, role: 'customer', password_hash: passwordHash, created_at: new Date() }
  : null)
authService.registerUser = async () => ({ id: 'new-user' })
reservationService.createReservation = async () => {
  state.calls.createReservation += 1
  if (state.reservationOutcome === 'sold-out') throw new AppError('There are not enough tickets available for that quantity.', 409)
  if (state.reservationOutcome === 'hold-cap') throw new AppError('You can hold at most 2 pending reservations at a time.', 409)
  return { id: 'reservation' }
}
reservationService.listReservations = async () => []
reservationService.getReservationForUser = async () => null
reservationService.cancelReservation = async () => { state.calls.cancelReservation += 1; return { outcome: 'not-found' } }
bookingService.checkoutReservation = async () => ({ outcome: 'ok', responseStatus: 201, responseBody: { success: true } })
paymentService.startPayment = async () => { state.calls.startPayment += 1; return { payment: { id: 'payment' }, created: true } }
paymentService.cancelPayment = async () => ({ outcome: 'cancelled', payment: null })
paymentService.getLatestPayment = async () => ({ found: false })
eventPosterService.uploadEventPoster = async () => { state.calls.posterUpload += 1; return null }
eventPosterService.removeEventPoster = async () => null

const app = require('../../server/src/app')
const { rateLimiters } = require('../../server/src/middleware/rateLimiters')

const ID = '00000000-0000-4000-8000-000000000001'
const EVENT_BODY = { event_id: ID, ticket_type_id: ID, quantity: 2 }

function cookieFor(userId) {
  const token = jwt.sign({}, process.env.JWT_SECRET, {
    algorithm: 'HS256', subject: userId, issuer: 'encore-api', audience: 'encore-client', expiresIn: '1h',
  })
  return { Cookie: `encore_session=${token}` }
}

async function scenario(run) {
  await rateLimiters.resetAll()
  state.reservationOutcome = 'created'
  Object.keys(state.calls).forEach((key) => { state.calls[key] = 0 })
  try {
    await withServer(app, run)
  } finally {
    await rateLimiters.resetAll()
  }
}

function assertRateLimited(response) {
  assert.equal(response.status, 429)
  assert.equal(response.body.success, false)
  assert.equal(typeof response.body.message, 'string')
  assert.ok(Number(response.headers.get('retry-after')) >= 1)
}

const login = (base, email, password) => send(base, 'POST', '/api/auth/login', { json: { email, password } })
const create = (base, user) => send(base, 'POST', '/api/reservations', { headers: cookieFor(user), json: EVENT_BODY })

test('POST /api/auth/login is limited per IP', async () => {
  await scenario(async (base) => {
    for (let i = 0; i < 10; i += 1) assert.equal((await send(base, 'POST', '/api/auth/login', { json: {} })).status, 400)
    assertRateLimited(await send(base, 'POST', '/api/auth/login', { json: {} }))
  })
})

test('POST /api/auth/login counts only failed logins toward the email-and-IP limit', async () => {
  await scenario(async (base) => {
    for (let i = 0; i < 4; i += 1) {
      const success = await login(base, 'member@example.com', PASSWORD)
      assert.equal(success.status, 200)
      assert.match(success.headers.get('set-cookie'), /encore_session=/)
    }
    assert.equal((await login(base, 'Member@Example.com', 'wrong')).status, 401)
    assert.equal((await login(base, ' member@example.com ', 'wrong')).status, 401)
    assertRateLimited(await login(base, 'MEMBER@EXAMPLE.COM', 'wrong'))
  })
})

test('POST /api/auth/register is limited, and validation errors do not use up attempts', async () => {
  await scenario(async (base) => {
    for (let i = 0; i < 4; i += 1) assert.equal((await send(base, 'POST', '/api/auth/register', { json: {} })).status, 400)
    const body = { name: 'New User', email: 'new@example.com', password: 'long-enough-password' }
    assert.equal((await send(base, 'POST', '/api/auth/register', { json: body })).status, 201)
    assert.equal((await send(base, 'POST', '/api/auth/register', { json: body })).status, 201)
    assertRateLimited(await send(base, 'POST', '/api/auth/register', { json: body }))
  })
})

test('POST /api/reservations: creation is limited per account, not per IP', async () => {
  await scenario(async (base) => {
    // IP backstop is 3, so keep to 3 creations in total across accounts here.
    assert.equal((await create(base, 'user-a')).status, 201)
    assert.equal((await create(base, 'user-a')).status, 201)
    assertRateLimited(await create(base, 'user-a'))
    assert.equal((await create(base, 'user-b')).status, 201)
    assert.equal(state.calls.createReservation, 3)
  })
})

test('POST /api/reservations: the per-IP backstop limits creations across accounts', async () => {
  await scenario(async (base) => {
    assert.equal((await create(base, 'user-a')).status, 201)
    assert.equal((await create(base, 'user-b')).status, 201)
    assert.equal((await create(base, 'user-c')).status, 201)
    assertRateLimited(await create(base, 'user-d'))
  })
})

test('POST /api/reservations: sold-out and hold-cap 409s and validation 400s use the attempt bucket only', async () => {
  for (const outcome of ['sold-out', 'hold-cap']) {
    await scenario(async (base) => {
      state.reservationOutcome = outcome
      for (let i = 0; i < 2; i += 1) assert.equal((await create(base, 'user-a')).status, 409)
      for (let i = 0; i < 2; i += 1) {
        assert.equal((await send(base, 'POST', '/api/reservations', { headers: cookieFor('user-a'), json: {} })).status, 400)
      }
      assertRateLimited(await create(base, 'user-a')) // fifth attempt: attempt bucket (4) is spent
      assert.equal(state.calls.createReservation, 2, 'a limited attempt must never reach the handler')
      // Creation capacity is untouched, so after a reset-free switch to success it still works for another account.
      state.reservationOutcome = 'created'
      assert.equal((await create(base, 'user-b')).status, 201)
    })
  }
})

test('unauthenticated requests are rejected by authentication before any account limiter runs', async () => {
  await scenario(async (base) => {
    for (let i = 0; i < 6; i += 1) {
      assert.equal((await send(base, 'POST', '/api/reservations', { json: EVENT_BODY })).status, 401)
      assert.equal((await send(base, 'POST', `/api/reservations/${ID}/cancel`, { json: {} })).status, 401)
    }
  })
})

test('POST /api/reservations/:id/cancel is limited per account and counts error responses', async () => {
  await scenario(async (base) => {
    const cancel = (user) => send(base, 'POST', `/api/reservations/${ID}/cancel`, { headers: cookieFor(user), json: {} })
    assert.equal((await cancel('user-a')).status, 404)
    assert.equal((await cancel('user-a')).status, 404)
    assertRateLimited(await cancel('user-a'))
    assert.equal(state.calls.cancelReservation, 2)
    assert.equal((await cancel('user-b')).status, 404)
    // Cancellation does not use the creation or read buckets.
    assert.equal((await create(base, 'user-a')).status, 201)
  })
})

test('GET reservation routes share one per-account read limit; writes are not counted in it', async () => {
  await scenario(async (base) => {
    const headers = cookieFor('user-a')
    await create(base, 'user-a')
    await send(base, 'POST', `/api/reservations/${ID}/cancel`, { headers, json: {} })
    assert.equal((await send(base, 'GET', '/api/reservations', { headers })).status, 200)
    assert.equal((await send(base, 'GET', `/api/reservations/${ID}`, { headers })).status, 404)
    assert.equal((await send(base, 'GET', `/api/reservations/${ID}/payments/latest`, { headers })).status, 404)
    assertRateLimited(await send(base, 'GET', '/api/reservations', { headers }))
    assert.equal((await send(base, 'GET', '/api/reservations', { headers: cookieFor('user-b') })).status, 200)
  })
})

test('checkout and payment start share a per-account limit; cancellation has its own', async () => {
  await scenario(async (base) => {
    const headers = { ...cookieFor('user-a'), 'Idempotency-Key': 'unit-test-key-0001' }
    const checkout = () => send(base, 'POST', `/api/reservations/${ID}/checkout`, { headers, json: {} })
    const payments = () => send(base, 'POST', `/api/reservations/${ID}/payments`, { headers, json: {} })
    const cancel = () => send(base, 'POST', `/api/reservations/${ID}/payments/cancel`, { headers, json: {} })

    assert.equal((await checkout()).status, 201)
    assert.equal((await payments()).status, 201)
    assertRateLimited(await checkout())
    assertRateLimited(await payments())

    assert.equal((await cancel()).status, 200)
    assert.equal((await cancel()).status, 200)
    assertRateLimited(await cancel())

    const other = { ...cookieFor('user-b'), 'Idempotency-Key': 'unit-test-key-0002' }
    assert.equal((await send(base, 'POST', `/api/reservations/${ID}/checkout`, { headers: other, json: {} })).status, 201)
  })
})

test('a 429 is returned before the handler runs, so nothing is created', async () => {
  await scenario(async (base) => {
    const headers = cookieFor('user-a')
    const payments = () => send(base, 'POST', `/api/reservations/${ID}/payments`, { headers, json: {} })
    await payments()
    await payments()
    assertRateLimited(await payments())
    assert.equal(state.calls.startPayment, 2)
  })
})

// Passes the poster validator (PNG signature + IHDR) so an unlimited upload really reaches the stubbed service.
const VALID_PNG_HEADER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.alloc(8),
])

function posterRequest(base, method, user) {
  const headers = { ...cookieFor(user), 'Content-Type': 'image/png' }
  return fetch(`${base}/api/admin/events/${ID}/poster?expected_poster=none`, { method, headers, body: method === 'POST' ? VALID_PNG_HEADER : undefined })
    .then(async (response) => ({ status: response.status, headers: response.headers, body: await response.json().catch(() => null) }))
}

test('poster upload and removal share a per-admin limit and the limiter runs before the body is read', async () => {
  await scenario(async (base) => {
    assert.equal((await posterRequest(base, 'POST', 'admin-1')).status, 404) // reached the stubbed service
    assert.equal(state.calls.posterUpload, 1)
    assert.equal((await posterRequest(base, 'DELETE', 'admin-1')).status, 404)
    assertRateLimited(await posterRequest(base, 'POST', 'admin-1'))
    assertRateLimited(await posterRequest(base, 'DELETE', 'admin-1'))
    assert.equal(state.calls.posterUpload, 1, 'a limited upload never reaches the poster service')
    assert.equal((await posterRequest(base, 'POST', 'admin-2')).status, 404)
    assert.equal(state.calls.posterUpload, 2)
  })
})

test('other admin writes are not covered by the poster limiter, and customers still get 403 first', async () => {
  await scenario(async (base) => {
    const headers = cookieFor('admin-1')
    for (let i = 0; i < 5; i += 1) {
      // A malformed event ID is rejected by validation (400) without touching a database.
      assert.equal((await send(base, 'PATCH', '/api/admin/events/not-a-uuid', { headers, json: {} })).status, 400)
    }
    for (let i = 0; i < 4; i += 1) {
      assert.equal((await posterRequest(base, 'DELETE', 'user-customer')).status, 403)
    }
  })
})

test('general GET limiter applies to API reads', async () => {
  await scenario(async (base) => {
    for (let i = 0; i < 6; i += 1) assert.equal((await send(base, 'GET', '/api/payments/config')).status, 200)
    assertRateLimited(await send(base, 'GET', '/api/payments/config'))
  })
})

test('health, readiness and the Stripe webhook are exempt from the general limiter on the real app', async () => {
  await scenario(async (base) => {
    for (let i = 0; i < 10; i += 1) {
      assert.equal((await send(base, 'GET', '/api/health')).status, 200)
      // DATABASE_URL is blank, so the probe fails fast with its own 503 without connecting.
      assert.equal((await send(base, 'GET', '/api/ready')).status, 503)
      // Simulated payment mode: the webhook answers 404 before reading the body or the database.
      assert.equal((await send(base, 'POST', '/api/payments/stripe/webhook', { json: {} })).status, 404)
    }
  })
})

test('a 429 carries CORS headers for the allowed origin so the browser can read it', async () => {
  await scenario(async (base) => {
    const origin = 'http://localhost:5173'
    for (let i = 0; i < 6; i += 1) await send(base, 'GET', '/api/payments/config', { headers: { Origin: origin } })
    const limited = await send(base, 'GET', '/api/payments/config', { headers: { Origin: origin } })
    assert.equal(limited.status, 429)
    assert.equal(limited.headers.get('access-control-allow-origin'), origin)
    assert.deepEqual(Object.keys(limited.body).sort(), ['message', 'success'])
  })
})
