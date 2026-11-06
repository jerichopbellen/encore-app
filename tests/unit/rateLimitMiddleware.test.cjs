const assert = require('node:assert/strict')
const test = require('node:test')
const { serverRequire } = require('../helpers/listen.cjs')
const express = serverRequire('express')
const errorMiddleware = require('../../server/src/middleware/errorMiddleware')
const {
  createRateLimiters,
  configureTrustProxy,
  normalizeEmailForRateLimit,
} = require('../../server/src/middleware/rateLimiters')
const { withServer, send } = require('../helpers/listen.cjs')

const HOUR = 60 * 60 * 1000
const originalWarn = console.warn
console.warn = () => {} // rate_limited log lines are asserted explicitly in one test below

function buildConfig(overrides = {}) {
  const limit = (value) => ({ limit: value, windowMs: HOUR })
  return {
    trustProxyHops: null,
    ipLimitingEnabled: true,
    maxKeys: 1000,
    ...overrides,
    limits: {
      loginIp: limit(1000),
      loginFailure: limit(2),
      loginFailureNoIp: limit(4),
      registration: limit(2),
      reservationCreation: limit(2),
      reservationAttempt: limit(4),
      reservationIp: limit(1000),
      reservationCancel: limit(3),
      reservationRead: limit(3),
      paymentInitiation: limit(2),
      paymentCancellation: limit(3),
      posterMutation: limit(2),
      generalRead: limit(2),
      ...overrides.limits,
    },
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// A stand-in API that mirrors how app.js and the route files mount the limiters, with
// handlers that return the statuses the real controllers do and touch no database.
function buildApp(limiters, { trustProxyHops = null, delayMs = 0 } = {}) {
  const app = express()
  configureTrustProxy(app, trustProxyHops)
  app.use(express.json())
  app.get('/api/health', (req, res) => res.json({ ok: true }))
  app.get('/api/ready', (req, res) => res.json({ ok: true }))
  app.post('/api/payments/stripe/webhook', (req, res) => res.json({ received: true }))
  app.use('/api', limiters.generalRead)

  const respond = async (req, res) => {
    if (delayMs) await sleep(delayMs)
    return res.status(Number(req.get('x-test-status') || 201)).json({ success: true })
  }

  app.post('/api/auth/login', limiters.loginIp, limiters.loginFailure, async (req, res) => {
    if (delayMs) await sleep(delayMs)
    const { email, password } = req.body ?? {}
    if (typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ success: false, message: 'Email and password are required.' })
    if (password !== 'correct-password') return res.status(401).json({ success: false, message: 'Invalid email or password.' })
    return res.json({ success: true })
  })
  app.post('/api/auth/register', limiters.registration, (req, res) => {
    if (!req.body?.valid) return res.status(400).json({ success: false, message: 'Invalid.' })
    return res.status(201).json({ success: true })
  })

  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user')
    if (id) req.user = { id }
    next()
  }
  const reservations = express.Router()
  reservations.use(authenticate)
  reservations.use(limiters.reservationRead)
  reservations.post('/', limiters.reservationAttempt, limiters.reservationCreation, limiters.reservationIp, respond)
  reservations.get('/', (req, res) => res.status(200).json({ success: true }))
  reservations.post('/:id/cancel', limiters.reservationCancel, respond)
  reservations.post('/:id/checkout', limiters.paymentInitiation, respond)
  reservations.post('/:id/payments', limiters.paymentInitiation, respond)
  reservations.post('/:id/payments/cancel', limiters.paymentCancellation, respond)
  app.use('/api/reservations', reservations)

  const admin = express.Router()
  admin.use(authenticate)
  admin.post('/events/:id/poster', limiters.posterMutation, respond)
  admin.delete('/events/:id/poster', limiters.posterMutation, respond)
  admin.patch('/events/:id', respond) // database-only admin write: not limited
  app.use('/api/admin', admin)

  app.use(errorMiddleware)
  return app
}

async function run(config, appOptions, scenario, limiterOptions) {
  const limiters = createRateLimiters(config, limiterOptions)
  try {
    await withServer(buildApp(limiters, appOptions), (base) => scenario(base, limiters))
  } finally {
    limiters.shutdown()
  }
}

const login = (base, email, password = 'wrong-password', headers = {}) =>
  send(base, 'POST', '/api/auth/login', { headers, json: { email, password } })

function assertRateLimited(response) {
  assert.equal(response.status, 429)
  assert.equal(response.body.success, false)
  assert.equal(typeof response.body.message, 'string')
  assert.deepEqual(Object.keys(response.body).sort(), ['message', 'success'])
  const retryAfter = Number(response.headers.get('retry-after'))
  assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 3600, `Retry-After was ${retryAfter}`)
}

// Highest counter currently held by any limiter (what the next request would be measured against).
const highestCount = (limiters) => Math.max(0, ...limiters.stores.flatMap((store) => [...store.entries.values()].map((entry) => entry.totalHits)))
const countsOf = (store) => [...store.entries.values()].map((entry) => entry.totalHits)

// ---------------------------------------------------------------- login

test('login IP limiter: blocks after the limit with the standard 429 body and Retry-After', async () => {
  await run(buildConfig({ limits: { loginIp: { limit: 3, windowMs: HOUR }, loginFailure: { limit: 100, windowMs: HOUR } } }), {}, async (base) => {
    for (let i = 0; i < 3; i += 1) assert.equal((await login(base, `user${i}@example.com`)).status, 401)
    assertRateLimited(await login(base, 'user9@example.com'))
  })
})

test('login failure limiter: counts failures per email and blocks the next attempt', async () => {
  await run(buildConfig(), {}, async (base) => {
    assert.equal((await login(base, 'ana@example.com')).status, 401)
    assert.equal((await login(base, 'ana@example.com')).status, 401)
    assertRateLimited(await login(base, 'ana@example.com'))
    // The lockout also covers the correct password for that email and IP.
    assert.equal((await login(base, 'ana@example.com', 'correct-password')).status, 429)
    assert.equal((await login(base, 'ben@example.com')).status, 401)
  })
})

test('successful logins never count toward the failed-attempt limit', async () => {
  await run(buildConfig(), {}, async (base) => {
    for (let i = 0; i < 6; i += 1) assert.equal((await login(base, 'ana@example.com', 'correct-password')).status, 200)
    assert.equal((await login(base, 'ana@example.com')).status, 401)
    assert.equal((await login(base, 'ana@example.com')).status, 401)
    assertRateLimited(await login(base, 'ana@example.com'))
  })
})

test('validation errors are not counted as failed logins', async () => {
  await run(buildConfig(), {}, async (base) => {
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await send(base, 'POST', '/api/auth/login', { json: { email: 'ana@example.com' } })).status, 400)
      assert.equal((await send(base, 'POST', '/api/auth/login', { json: { password: 'x' } })).status, 400)
    }
    assert.equal((await login(base, 'ana@example.com')).status, 401)
  })
})

test('email normalization: case and surrounding spaces share one failure counter', async () => {
  assert.equal(normalizeEmailForRateLimit({ email: '  Ana@Example.COM ' }), 'ana@example.com')
  assert.equal(normalizeEmailForRateLimit({ email: 42 }), null)
  assert.equal(normalizeEmailForRateLimit({ email: '   ' }), null)
  assert.equal(normalizeEmailForRateLimit(undefined), null)

  await run(buildConfig(), {}, async (base) => {
    assert.equal((await login(base, 'Ana@Example.com')).status, 401)
    assert.equal((await login(base, '  ana@example.com ')).status, 401)
    assert.equal((await login(base, 'ANA@EXAMPLE.COM')).status, 429)
  })
})

test('the 429 for a registered email and an unknown email is identical', async () => {
  await run(buildConfig(), {}, async (base) => {
    const bodies = []
    for (const email of ['registered@example.com', 'unknown@example.com']) {
      await login(base, email)
      await login(base, email)
      const blocked = await login(base, email)
      assert.equal(blocked.status, 429)
      bodies.push(blocked.body)
    }
    assert.deepEqual(bodies[0], bodies[1])
  })
})

test('failure counters are separate per IP, so another IP cannot lock the owner out', async () => {
  await run(buildConfig(), { trustProxyHops: 1 }, async (base) => {
    const from = (ip) => ({ 'X-Forwarded-For': ip })
    await login(base, 'victim@example.com', 'bad', from('198.51.100.1'))
    await login(base, 'victim@example.com', 'bad', from('198.51.100.1'))
    assert.equal((await login(base, 'victim@example.com', 'bad', from('198.51.100.1'))).status, 429)
    assert.equal((await login(base, 'victim@example.com', 'correct-password', from('203.0.113.7'))).status, 200)
  })
})

test('no-IP fallback: email-only key, its own generous threshold, same generic 429', async () => {
  // The configured fallback threshold is 4 here; the shipped default is 50 per hour.
  await run(buildConfig({ ipLimitingEnabled: false }), {}, async (base) => {
    for (let i = 0; i < 4; i += 1) {
      assert.equal((await login(base, 'ana@example.com', 'bad', { 'X-Forwarded-For': `1.1.1.${i}` })).status, 401)
    }
    const blocked = await login(base, 'ana@example.com', 'bad', { 'X-Forwarded-For': '9.9.9.9' })
    assertRateLimited(blocked)
    // Registered and unknown emails produce the very same 429.
    for (let i = 0; i < 4; i += 1) await login(base, 'nobody@example.com')
    assert.deepEqual((await login(base, 'nobody@example.com')).body, blocked.body)
    // Successes and other emails are unaffected.
    assert.equal((await login(base, 'ben@example.com', 'correct-password')).status, 200)
  })
})

test('no-IP fallback is far more generous than the email-plus-IP limit', async () => {
  const config = buildConfig({ ipLimitingEnabled: false, limits: { loginFailure: { limit: 2, windowMs: HOUR }, loginFailureNoIp: { limit: 50, windowMs: HOUR } } })
  await run(config, {}, async (base) => {
    for (let i = 0; i < 50; i += 1) assert.equal((await login(base, 'ana@example.com')).status, 401)
    assertRateLimited(await login(base, 'ana@example.com'))
  })
})

test('the login IP limiter is inactive without a trusted IP', async () => {
  await run(buildConfig({ ipLimitingEnabled: false, limits: { loginIp: { limit: 1, windowMs: HOUR }, loginFailureNoIp: { limit: 1000, windowMs: HOUR } } }), {}, async (base) => {
    for (let i = 0; i < 5; i += 1) assert.equal((await login(base, `u${i}@example.com`)).status, 401)
  })
})

// ---------------------------------------------------------------- registration

test('registration limiter: blocks after the limit, ignores validation errors', async () => {
  await run(buildConfig(), {}, async (base) => {
    for (let i = 0; i < 6; i += 1) assert.equal((await send(base, 'POST', '/api/auth/register', { json: {} })).status, 400)
    assert.equal((await send(base, 'POST', '/api/auth/register', { json: { valid: true } })).status, 201)
    assert.equal((await send(base, 'POST', '/api/auth/register', { json: { valid: true } })).status, 201)
    assertRateLimited(await send(base, 'POST', '/api/auth/register', { json: { valid: true } }))
  })
})

test('registration is not limited by IP when no trusted IP is available', async () => {
  await run(buildConfig({ ipLimitingEnabled: false }), {}, async (base) => {
    for (let i = 0; i < 6; i += 1) assert.equal((await send(base, 'POST', '/api/auth/register', { json: { valid: true } })).status, 201)
  })
})

// ---------------------------------------------------------------- reservations

const reserve = (base, user, status) =>
  send(base, 'POST', '/api/reservations', { headers: { ...(user ? { 'x-test-user': user } : {}), ...(status ? { 'x-test-status': String(status) } : {}) }, json: {} })

const storeFor = (limiters, name) => limiters.stores[Object.keys(limiters).filter((key) => !['stores', 'resetAll', 'shutdown'].includes(key)).indexOf(name)]

test('a successful creation (201) consumes both the creation and the attempt buckets', async () => {
  await run(buildConfig(), {}, async (base, limiters) => {
    assert.equal((await reserve(base, 'user-a')).status, 201)
    await sleep(20)
    assert.deepEqual(countsOf(storeFor(limiters, 'reservationAttempt')), [1])
    assert.deepEqual(countsOf(storeFor(limiters, 'reservationCreation')), [1])
  })
})

test('creation bucket blocks the third success per account while users stay independent', async () => {
  await run(buildConfig(), {}, async (base) => {
    assert.equal((await reserve(base, 'user-a')).status, 201)
    assert.equal((await reserve(base, 'user-a')).status, 201)
    assertRateLimited(await reserve(base, 'user-a'))
    assert.equal((await reserve(base, 'user-b')).status, 201)
    assert.equal((await reserve(base, 'user-b')).status, 201)
    assertRateLimited(await reserve(base, 'user-b'))
  })
})

for (const [label, status] of [['sold-out 409', 409], ['hold-cap 409', 409], ['validation/database 400', 400], ['not-found 404', 404], ['server error 500', 500]]) {
  test(`${label} consumes the attempt bucket but not the creation bucket`, async () => {
    await run(buildConfig(), {}, async (base, limiters) => {
      for (let i = 0; i < 4; i += 1) assert.equal((await reserve(base, 'user-a', status)).status, status)
      await sleep(20)
      assert.deepEqual(countsOf(storeFor(limiters, 'reservationAttempt')), [4])
      assert.equal(storeFor(limiters, 'reservationCreation').size, 0)
      assertRateLimited(await reserve(base, 'user-a', status))
    })
  })
}

test('the creation bucket counts only 201 responses, however many failures come first', async () => {
  await run(buildConfig({ limits: { reservationAttempt: { limit: 50, windowMs: HOUR } } }), {}, async (base) => {
    for (let i = 0; i < 10; i += 1) assert.equal((await reserve(base, 'user-a', 409)).status, 409)
    assert.equal((await reserve(base, 'user-a')).status, 201)
    assert.equal((await reserve(base, 'user-a')).status, 201)
    assertRateLimited(await reserve(base, 'user-a'))
  })
})

test('a 429 from the creation bucket does not consume attempt capacity', async () => {
  await run(buildConfig({ limits: { reservationAttempt: { limit: 5, windowMs: HOUR } } }), {}, async (base, limiters) => {
    await reserve(base, 'user-a')
    await reserve(base, 'user-a')
    for (let i = 0; i < 20; i += 1) assert.equal((await reserve(base, 'user-a')).status, 429)
    await sleep(30)
    assert.deepEqual(countsOf(storeFor(limiters, 'reservationAttempt')), [2])
    assert.deepEqual(countsOf(storeFor(limiters, 'reservationCreation')), [2])
  })
})

test('the reservation IP backstop limits across accounts, and is off without a trusted IP', async () => {
  const backstop = { reservationCreation: { limit: 1000, windowMs: HOUR }, reservationIp: { limit: 2, windowMs: HOUR } }
  await run(buildConfig({ limits: backstop }), {}, async (base) => {
    assert.equal((await reserve(base, 'user-a')).status, 201)
    assert.equal((await reserve(base, 'user-b')).status, 201)
    assertRateLimited(await reserve(base, 'user-c'))
  })
  await run(buildConfig({ ipLimitingEnabled: false, limits: backstop }), {}, async (base) => {
    for (const user of ['a', 'b', 'c', 'd']) assert.equal((await reserve(base, `user-${user}`)).status, 201)
  })
})

test('account limiters keep working when no trusted IP is available', async () => {
  await run(buildConfig({ ipLimitingEnabled: false }), {}, async (base) => {
    await reserve(base, 'user-a')
    await reserve(base, 'user-a')
    assertRateLimited(await reserve(base, 'user-a'))
  })
})

test('an account limiter mounted without authentication fails loudly instead of sharing one bucket', async () => {
  await run(buildConfig(), {}, async (base) => {
    const response = await reserve(base, null)
    assert.equal(response.status, 500)
    assert.deepEqual(response.body, { success: false, message: 'An unexpected server error occurred.' })
  })
})

const cancel = (base, user, status) =>
  send(base, 'POST', '/api/reservations/res-1/cancel', { headers: { 'x-test-user': user, ...(status ? { 'x-test-status': String(status) } : {}) }, json: {} })

test('cancellation counts every attempt, including errors, so failing requests cannot bypass it', async () => {
  await run(buildConfig(), {}, async (base) => {
    for (const status of [404, 409, 400]) assert.equal((await cancel(base, 'user-a', status)).status, status)
    assertRateLimited(await cancel(base, 'user-a', 404))
    assert.equal((await cancel(base, 'user-b', 200)).status, 200)
  })
})

test('reservation reads are limited per account, GET only, without double counting writes', async () => {
  await run(buildConfig({ limits: { generalRead: { limit: 1000, windowMs: HOUR } } }), {}, async (base, limiters) => {
    const read = () => send(base, 'GET', '/api/reservations', { headers: { 'x-test-user': 'user-a' } })
    // Writes pass through reservationRead without being counted.
    await reserve(base, 'user-a')
    await cancel(base, 'user-a', 200)
    await pay(base, 'user-a', 'payments')
    await sleep(20)
    assert.equal(storeFor(limiters, 'reservationRead').size, 0)

    assert.equal((await read()).status, 200)
    assert.equal((await read()).status, 200)
    assert.equal((await read()).status, 200)
    assertRateLimited(await read())
    // Another account has its own reads; the blocked account can still write.
    assert.equal((await send(base, 'GET', '/api/reservations', { headers: { 'x-test-user': 'user-b' } })).status, 200)
    assert.equal((await cancel(base, 'user-a', 200)).status, 200)
  })
})

// ---------------------------------------------------------------- payments

const pay = (base, user, path, status, headers = {}) =>
  send(base, 'POST', `/api/reservations/res-1/${path}`, { headers: { 'x-test-user': user, ...(status ? { 'x-test-status': String(status) } : {}), ...headers }, json: {} })

test('checkout and payment start share one per-account bucket', async () => {
  await run(buildConfig(), {}, async (base) => {
    assert.equal((await pay(base, 'user-a', 'checkout')).status, 201)
    assert.equal((await pay(base, 'user-a', 'payments')).status, 201)
    assertRateLimited(await pay(base, 'user-a', 'checkout'))
    assertRateLimited(await pay(base, 'user-a', 'payments'))
    assert.equal((await pay(base, 'user-b', 'checkout')).status, 201)
  })
})

test('repeating a checkout with the same Idempotency-Key still counts, so the limit leaves retry headroom', async () => {
  await run(buildConfig({ limits: { paymentInitiation: { limit: 3, windowMs: HOUR } } }), {}, async (base) => {
    const headers = { 'Idempotency-Key': 'same-key-0001' }
    for (let i = 0; i < 3; i += 1) assert.equal((await pay(base, 'user-a', 'checkout', 200, headers)).status, 200)
    assertRateLimited(await pay(base, 'user-a', 'checkout', 200, headers))
  })
})

test('payment validation errors (400) are not counted', async () => {
  await run(buildConfig(), {}, async (base) => {
    for (let i = 0; i < 6; i += 1) assert.equal((await pay(base, 'user-a', 'payments', 400)).status, 400)
    assert.equal((await pay(base, 'user-a', 'payments')).status, 201)
  })
})

test('payment cancellation has its own bucket, so an exhausted payment limit never blocks cancelling', async () => {
  await run(buildConfig(), {}, async (base) => {
    await pay(base, 'user-a', 'payments')
    await pay(base, 'user-a', 'payments')
    assertRateLimited(await pay(base, 'user-a', 'payments'))
    for (let i = 0; i < 3; i += 1) assert.equal((await pay(base, 'user-a', 'payments/cancel', 200)).status, 200)
    assertRateLimited(await pay(base, 'user-a', 'payments/cancel', 200))
    assert.equal((await pay(base, 'user-b', 'payments/cancel', 200)).status, 200)
  })
})

// ---------------------------------------------------------------- posters

test('poster upload and removal share one per-account bucket; other admin writes are untouched', async () => {
  await run(buildConfig(), {}, async (base) => {
    const upload = (user) => send(base, 'POST', '/api/admin/events/e1/poster', { headers: { 'x-test-user': user, 'x-test-status': '200' }, json: {} })
    const remove = (user) => send(base, 'DELETE', '/api/admin/events/e1/poster', { headers: { 'x-test-user': user, 'x-test-status': '200' } })
    assert.equal((await upload('admin-1')).status, 200)
    assert.equal((await remove('admin-1')).status, 200)
    assertRateLimited(await upload('admin-1'))
    assertRateLimited(await remove('admin-1'))
    assert.equal((await upload('admin-2')).status, 200)
    for (let i = 0; i < 6; i += 1) {
      assert.equal((await send(base, 'PATCH', '/api/admin/events/e1', { headers: { 'x-test-user': 'admin-1', 'x-test-status': '200' }, json: {} })).status, 200)
    }
  })
})

// ---------------------------------------------------------------- general / exemptions

test('general read limiter: limits GET requests per IP and leaves other methods alone', async () => {
  await run(buildConfig(), {}, async (base) => {
    assert.equal((await send(base, 'GET', '/api/events')).status, 404)
    assert.equal((await send(base, 'GET', '/api/events')).status, 404)
    assertRateLimited(await send(base, 'GET', '/api/events'))
    assert.equal((await send(base, 'POST', '/api/events', { json: {} })).status, 404)
  })
})

test('health, readiness and the Stripe webhook never reach the general limiter', async () => {
  await run(buildConfig({ limits: { generalRead: { limit: 1, windowMs: HOUR } } }), {}, async (base) => {
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await send(base, 'GET', '/api/health')).status, 200)
      assert.equal((await send(base, 'GET', '/api/ready')).status, 200)
      assert.equal((await send(base, 'POST', '/api/payments/stripe/webhook', { json: {} })).status, 200)
    }
  })
})

test('the general limiter itself skips exempt paths even if mounted before them', async () => {
  const limiters = createRateLimiters(buildConfig({ limits: { generalRead: { limit: 1, windowMs: HOUR } } }))
  const app = express()
  app.use('/api', limiters.generalRead)
  app.get('/api/health', (req, res) => res.json({ ok: true }))
  app.get('/api/ready', (req, res) => res.json({ ok: true }))
  app.get('/api/payments/stripe/webhook', (req, res) => res.json({ ok: true }))
  app.get('/api/other', (req, res) => res.json({ ok: true }))
  app.use(errorMiddleware)
  try {
    await withServer(app, async (base) => {
      for (let i = 0; i < 4; i += 1) {
        for (const path of ['/api/health', '/api/ready', '/api/payments/stripe/webhook']) {
          assert.equal((await send(base, 'GET', path)).status, 200, path)
        }
      }
      assert.equal((await send(base, 'GET', '/api/other')).status, 200)
      assert.equal((await send(base, 'GET', '/api/other')).status, 429)
    })
  } finally {
    limiters.shutdown()
  }
})

test('the general limiter is inactive without a trusted IP', async () => {
  await run(buildConfig({ ipLimitingEnabled: false }), {}, async (base) => {
    for (let i = 0; i < 6; i += 1) assert.equal((await send(base, 'GET', '/api/events')).status, 404)
  })
})

test('trusted proxy: only the verified hop is believed, a client-forged leading address is ignored', async () => {
  await run(buildConfig({ limits: { generalRead: { limit: 1, windowMs: HOUR } } }), { trustProxyHops: 1 }, async (base) => {
    assert.equal((await send(base, 'GET', '/api/events', { headers: { 'X-Forwarded-For': '1.1.1.1, 203.0.113.5' } })).status, 404)
    assertRateLimited(await send(base, 'GET', '/api/events', { headers: { 'X-Forwarded-For': '2.2.2.2, 203.0.113.5' } }))
    assert.equal((await send(base, 'GET', '/api/events', { headers: { 'X-Forwarded-For': '3.3.3.3, 203.0.113.99' } })).status, 404)
  })
})

test('with no verified proxy, X-Forwarded-For is ignored entirely', async () => {
  await run(buildConfig({ limits: { generalRead: { limit: 1, windowMs: HOUR } } }), {}, async (base) => {
    assert.equal((await send(base, 'GET', '/api/events', { headers: { 'X-Forwarded-For': '1.1.1.1' } })).status, 404)
    assertRateLimited(await send(base, 'GET', '/api/events', { headers: { 'X-Forwarded-For': '2.2.2.2' } }))
  })
})

// ---------------------------------------------------------------- 429s never inflate counters

const BLOCKED_REQUESTS = {
  loginIp: { config: { loginIp: 2 }, request: (base) => login(base, 'u@example.com', 'correct-password') },
  registration: { config: { registration: 2 }, request: (base) => send(base, 'POST', '/api/auth/register', { json: { valid: true } }) },
  reservationAttempt: { config: { reservationAttempt: 2 }, request: (base) => reserve(base, 'user-a', 409) },
  reservationCreation: { config: { reservationCreation: 2 }, request: (base) => reserve(base, 'user-a') },
  reservationCancel: { config: { reservationCancel: 2 }, request: (base) => cancel(base, 'user-a', 404) },
  paymentInitiation: { config: { paymentInitiation: 2 }, request: (base) => pay(base, 'user-a', 'payments') },
  paymentCancellation: { config: { paymentCancellation: 2 }, request: (base) => pay(base, 'user-a', 'payments/cancel', 200) },
  posterMutation: { config: { posterMutation: 2 }, request: (base) => send(base, 'POST', '/api/admin/events/e1/poster', { headers: { 'x-test-user': 'admin-1', 'x-test-status': '200' }, json: {} }) },
  generalRead: { config: { generalRead: 2 }, request: (base) => send(base, 'GET', '/api/events') },
  loginFailure: { config: { loginFailure: 2 }, request: (base) => login(base, 'ana@example.com') },
}

for (const [name, { config, request }] of Object.entries(BLOCKED_REQUESTS)) {
  test(`${name}: repeated blocked requests do not extend or inflate the counter`, async () => {
    const limits = Object.fromEntries(Object.entries(config).map(([key, limit]) => [key, { limit, windowMs: HOUR }]))
    // Other limiters on the same route are made roomy so only the limiter under test blocks.
    const roomy = Object.fromEntries(['reservationAttempt', 'reservationCreation', 'reservationIp', 'reservationRead', 'loginIp', 'loginFailure', 'generalRead']
      .filter((key) => !(key in limits)).map((key) => [key, { limit: 1000, windowMs: HOUR }]))
    await run(buildConfig({ limits: { ...roomy, ...limits } }), {}, async (base, limiters) => {
      const statuses = []
      for (let i = 0; i < 30; i += 1) statuses.push((await request(base)).status)
      await sleep(30) // response-finish bookkeeping runs after the response is sent
      assert.equal(statuses.filter((status) => status === 429).length, 28, `${name}: ${statuses.join(',')}`)
      const limit = Object.values(config)[0]
      const stored = limiters.stores.flatMap(countsOf)
      assert.ok(stored.every((count) => count <= limit), `counters were ${stored.join(',')} (limit ${limit})`)
    })
  })
}

// ---------------------------------------------------------------- concurrency

test('a parallel burst of failed logins admits exactly the configured number', async () => {
  await run(buildConfig({ limits: { loginFailure: { limit: 5, windowMs: HOUR } } }), { delayMs: 30 }, async (base) => {
    const statuses = await Promise.all(Array.from({ length: 40 }, () => login(base, 'ana@example.com').then((r) => r.status)))
    assert.equal(statuses.filter((status) => status === 401).length, 5)
    assert.equal(statuses.filter((status) => status === 429).length, 35)
  })
})

test('a parallel burst of reservation creations admits no more than the creation limit', async () => {
  await run(buildConfig({ limits: { reservationAttempt: { limit: 100, windowMs: HOUR } } }), { delayMs: 30 }, async (base) => {
    const statuses = await Promise.all(Array.from({ length: 30 }, () => reserve(base, 'user-a').then((r) => r.status)))
    assert.equal(statuses.filter((status) => status === 201).length, 2)
    assert.equal(statuses.filter((status) => status === 429).length, 28)
  })
})

test('a parallel burst never admits more than the attempt limit, and blocked ones leave the counter intact', async () => {
  // In-flight requests are counted on arrival, so the creation bucket is made roomy to isolate the attempt bucket.
  await run(buildConfig({ limits: { reservationAttempt: { limit: 4, windowMs: HOUR }, reservationCreation: { limit: 1000, windowMs: HOUR } } }), { delayMs: 30 }, async (base, limiters) => {
    const statuses = await Promise.all(Array.from({ length: 30 }, () => reserve(base, 'user-a', 409).then((r) => r.status)))
    assert.equal(statuses.filter((status) => status === 409).length, 4)
    await sleep(40)
    assert.deepEqual(countsOf(storeFor(limiters, 'reservationAttempt')), [4])
    assert.equal(highestCount(limiters), 4)
  })
})

// ---------------------------------------------------------------- capacity, clock, reset

test('a flood of unique emails cannot erase an active lockout, and new keys are refused at capacity', async () => {
  await run(buildConfig({ maxKeys: 5, limits: { loginFailure: { limit: 2, windowMs: HOUR } } }), {}, async (base, limiters) => {
    await login(base, 'victim@example.com')
    await login(base, 'victim@example.com')
    assert.equal((await login(base, 'victim@example.com')).status, 429)

    const statuses = []
    for (let i = 0; i < 25; i += 1) statuses.push((await login(base, `random-${i}@example.com`)).status)
    assert.ok(statuses.includes(429), 'new keys must be refused once the store is full')
    for (const store of limiters.stores) assert.ok(store.size <= 5, `store held ${store.size} keys`)

    // The victim is still locked, even for the correct password.
    assertRateLimited(await login(base, 'victim@example.com', 'correct-password'))
  })
})

test('windows reset using an injected clock, without waiting in real time', async () => {
  const clock = { now: Date.now() }
  await run(buildConfig(), {}, async (base) => {
    await login(base, 'ana@example.com')
    await login(base, 'ana@example.com')
    assert.equal((await login(base, 'ana@example.com')).status, 429)
    clock.now += HOUR + 1
    assert.equal((await login(base, 'ana@example.com')).status, 401)
  }, { now: () => clock.now })
})

test('very long emails are hashed into fixed-size keys', async () => {
  await run(buildConfig({ limits: { loginFailure: { limit: 100, windowMs: HOUR } } }), {}, async (base, limiters) => {
    await login(base, `${'a'.repeat(5000)}@example.com`)
    const longest = Math.max(...limiters.stores.flatMap((store) => [...store.entries.keys()].map((key) => key.length)))
    assert.ok(longest < 100, `longest key was ${longest} characters`)
  })
})

test('resetAll clears every limiter', async () => {
  await run(buildConfig(), {}, async (base, limiters) => {
    await login(base, 'ana@example.com')
    await login(base, 'ana@example.com')
    assert.equal((await login(base, 'ana@example.com')).status, 429)
    await limiters.resetAll()
    assert.equal((await login(base, 'ana@example.com')).status, 401)
  })
})

// ---------------------------------------------------------------- logging

test('a 429 is logged as rate_limited with only the limiter, route template and status', async () => {
  const lines = []
  console.warn = (line) => lines.push(line)
  try {
    await run(buildConfig({ trustProxyHops: 1 }), { trustProxyHops: 1 }, async (base) => {
      const secret = { 'X-Forwarded-For': '198.51.100.77', Cookie: 'encore_session=secret-token', Authorization: 'Bearer secret-token' }
      await login(base, 'person@example.com', 'bad-password-123', secret)
      await login(base, 'person@example.com', 'bad-password-123', secret)
      await login(base, 'person@example.com', 'bad-password-123', secret)
      await send(base, 'POST', '/api/reservations/res-secret-id/cancel', { headers: { 'x-test-user': 'user-secret-id' }, json: {} })
    })
  } finally {
    console.warn = () => {}
  }
  assert.equal(lines.length, 1)
  assert.deepEqual(JSON.parse(lines[0]), { event: 'rate_limited', limiter: 'loginFailure', route: '/api/auth/login', status: 429 })
  for (const forbidden of ['person@example.com', 'bad-password', '198.51.100.77', 'secret-token', 'user-secret-id', 'res-secret-id']) {
    assert.ok(!lines[0].includes(forbidden), `log leaked ${forbidden}`)
  }
})

test.after(() => { console.warn = originalWarn })
