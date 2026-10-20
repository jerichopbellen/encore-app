const test = require('node:test')
const assert = require('node:assert/strict')
const { randomBytes, randomUUID } = require('node:crypto')
const { Client } = require('../../server/node_modules/pg')
const Stripe = require('../../server/node_modules/stripe')
const { configureTestDatabase } = require('../helpers/testDatabase.cjs')

// Configure Prisma before requiring the app: the ordinary server/.env is never
// allowed to select a database for this suite.
configureTestDatabase()

// Dummy, test-only Stripe settings. No test in this file reaches the network: session
// creation is replaced by an in-memory gateway and webhook signatures are generated locally.
const WEBHOOK_SECRET = 'whsec_integration_test_only_secret'
process.env.NODE_ENV = 'test'
process.env.PAYMENT_PROVIDER = 'stripe'
process.env.STRIPE_SECRET_KEY = 'sk_test_integration_test_only_key'
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
process.env.FRONTEND_ORIGIN = 'http://localhost:5173'

const app = require('../../server/src/app')
const { getPrismaClient, disconnectPrisma } = require('../../server/src/config/prisma')
const { setGatewayForTests } = require('../../server/src/services/stripeGateway')
const { paymentHooks } = require('../../server/src/services/paymentService')

const stripeSigner = new Stripe(process.env.STRIPE_SECRET_KEY)
const MINUTE = 60 * 1000

function makeBarrier(parties) {
  let ready = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  return async (operation) => {
    ready += 1
    if (ready === parties) release()
    await gate
    return operation()
  }
}

function cookieFromLogin(response) {
  const headers = response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || '']
  const sessionCookie = headers.find((value) => /^encore_session=/i.test(value))
  assert.equal(Boolean(sessionCookie), true, 'Login should set an Encore session cookie.')
  return sessionCookie.split(';', 1)[0]
}

// Stands in for Stripe. Like Stripe, it replays the original session when the same
// idempotency key is reused with identical parameters.
function stripeError(raw) {
  // Built with the installed SDK's own classifier so tests see the same error classes production does.
  return Stripe.errors.generateV1Error({ message: 'Stripe test error', ...raw })
}

function createFakeStripe() {
  const state = {
    calls: [], expireCalls: [], sessions: new Map(), byId: new Map(), inflight: new Set(),
    failure: null, expireFailure: null, retrieveFailure: null, gate: null, onExpire: null, onRetrieve: null,
  }
  state.gateway = {
    async createCheckoutSession(params, idempotencyKey) {
      state.calls.push({ params, idempotencyKey })
      if (state.failure === 'network') {
        state.failure = null
        throw new Stripe.errors.StripeConnectionError({ message: 'network down' })
      }
      const previous = state.sessions.get(idempotencyKey)
      if (previous) {
        if (JSON.stringify(previous.params) !== JSON.stringify(params)) {
          throw stripeError({ type: 'idempotency_error', statusCode: 400, message: 'Keys for idempotent requests can only be used with the same parameters.' })
        }
        return previous.session
      }
      if (state.inflight.has(idempotencyKey)) {
        throw stripeError({ type: 'idempotency_error', code: 'idempotency_key_in_use', statusCode: 409, message: 'There is currently another in-progress request using this Stripe idempotency key.' })
      }
      if (state.failure === 'idempotency-mismatch') {
        state.failure = null
        throw stripeError({ type: 'idempotency_error', statusCode: 400, message: 'Keys for idempotent requests can only be used with the same parameters.' })
      }
      if (params.expires_at * 1000 < Date.now() + 30 * MINUTE) {
        // Stripe only accepts sessions that live at least 30 minutes from creation.
        throw stripeError({ type: 'invalid_request_error', statusCode: 400, message: 'The expires_at timestamp must be at least 30 minutes in the future.' })
      }
      if (state.failure === 'invalid') {
        state.failure = null
        throw stripeError({ type: 'invalid_request_error', statusCode: 400 })
      }
      state.inflight.add(idempotencyKey)
      try {
        if (state.gate) await state.gate
        const id = `cs_test_${randomUUID().replaceAll('-', '')}`
        const session = { id, url: `https://checkout.stripe.test/c/pay/${id}`, status: 'open' }
        state.sessions.set(idempotencyKey, { params, session })
        state.byId.set(id, session)
        if (state.failure === 'lost-response') {
          // Stripe created the session, but the response never reached Encore.
          state.failure = null
          throw new Stripe.errors.StripeConnectionError({ message: 'timeout' })
        }
        return session
      } finally {
        state.inflight.delete(idempotencyKey)
      }
    },
    async expireCheckoutSession(sessionId) {
      state.expireCalls.push(sessionId)
      if (state.onExpire) {
        const hook = state.onExpire
        state.onExpire = null
        await hook()
      }
      if (state.expireFailure === 'network') {
        state.expireFailure = null
        throw new Stripe.errors.StripeConnectionError({ message: 'network down' })
      }
      if (state.expireFailure === 'server') {
        state.expireFailure = null
        throw stripeError({ type: 'api_error', statusCode: 500 })
      }
      const session = state.byId.get(sessionId)
      if (!session) throw stripeError({ type: 'invalid_request_error', code: 'resource_missing', statusCode: 404 })
      if (session.status !== 'open') {
        throw stripeError({ type: 'invalid_request_error', statusCode: 400, message: "Only Checkout Sessions with a status in ['open'] can be expired." })
      }
      session.status = 'expired'
      return { id: sessionId, status: 'expired' }
    },
    async retrieveCheckoutSession(sessionId) {
      if (state.onRetrieve) {
        const hook = state.onRetrieve
        state.onRetrieve = null
        await hook()
      }
      if (state.retrieveFailure) {
        state.retrieveFailure = null
        throw new Stripe.errors.StripeConnectionError({ message: 'network down' })
      }
      const session = state.byId.get(sessionId)
      if (!session) throw stripeError({ type: 'invalid_request_error', code: 'resource_missing', statusCode: 404 })
      return { id: sessionId, status: session.status }
    },
  }
  state.setSessionStatus = (sessionId, status) => { state.byId.get(sessionId).status = status }
  return state
}

test('Stripe payment lifecycle against the dedicated PostgreSQL test database', async (t) => {
  const prisma = await getPrismaClient()
  const fake = createFakeStripe()
  setGatewayForTests(fake.gateway)
  const fixture = {
    emails: [], userIds: [], eventIds: [], ticketTypeIds: [], reservationIds: [], stripeEventIds: [],
    account: null, otherAccount: null, server: null,
  }
  let databaseReady = false
  let dbClient

  async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
    const response = await fetch(`${fixture.baseUrl}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { response, payload: await response.json().catch(() => null) }
  }

  async function createAccount(name) {
    const email = `encore-payments-${randomUUID()}@example.test`
    fixture.emails.push(email)
    const password = randomBytes(24).toString('base64url')
    const registration = await request('/api/auth/register', { method: 'POST', body: { name, email, password } })
    assert.equal(registration.response.status, 201)
    fixture.userIds.push(registration.payload.data.user.id)
    const login = await request('/api/auth/login', { method: 'POST', body: { email, password } })
    assert.equal(login.response.status, 200)
    return { id: registration.payload.data.user.id, email, cookie: cookieFromLogin(login.response) }
  }

  async function createEvent(title, startsAt = new Date(Date.now() + 86400000)) {
    const event = await prisma.events.create({
      data: { title: `${title} ${randomUUID()}`, description: 'Automated payment test fixture', venue: 'Encore Test Hall', starts_at: startsAt, status: 'published' },
    })
    fixture.eventIds.push(event.id)
    return event
  }

  async function createTicketType(eventId, availableQuantity = 8) {
    const ticketType = await prisma.ticket_types.create({
      data: { event_id: eventId, name: `Payment ticket ${randomUUID()}`, price: '12.35', total_quantity: 8, available_quantity: availableQuantity },
    })
    fixture.ticketTypeIds.push(ticketType.id)
    return ticketType
  }

  // Each scenario gets its own event, ticket type and reservation so assertions cannot overlap.
  async function reserve(account = fixture.account, { quantity = 2, startsAt } = {}) {
    const event = await createEvent('Payment Fixture', startsAt)
    const ticket = await createTicketType(event.id)
    const created = await request('/api/reservations', {
      method: 'POST', cookie: account.cookie, body: { event_id: event.id, ticket_type_id: ticket.id, quantity },
    })
    assert.equal(created.response.status, 201)
    const reservationId = created.payload.data.reservation.id
    fixture.reservationIds.push(reservationId)
    return { event, ticket, reservationId, quantity }
  }

  const startPayment = (reservationId, account = fixture.account, body) => request(`/api/reservations/${reservationId}/payments`, {
    method: 'POST', cookie: account.cookie, ...(body ? { body } : {}),
  })
  const latestPayment = (reservationId, account = fixture.account) => request(`/api/reservations/${reservationId}/payments/latest`, { cookie: account.cookie })
  const attemptsFor = (reservationId) => prisma.payment_attempts.findMany({ where: { reservation_id: reservationId }, orderBy: { created_at: 'asc' } })
  const latestAttempt = async (reservationId) => (await attemptsFor(reservationId)).at(-1)
  const bookingsFor = (reservationId) => prisma.bookings.findMany({ where: { reservation_id: reservationId } })
  const availableOf = async (ticketId) => (await prisma.ticket_types.findUnique({ where: { id: ticketId } })).available_quantity
  const reservationOf = (reservationId) => prisma.reservations.findUnique({ where: { id: reservationId } })

  async function openPayment(account = fixture.account, options) {
    const scenario = await reserve(account, options)
    const started = await startPayment(scenario.reservationId, account)
    assert.equal(started.response.status, 201, JSON.stringify(started.payload))
    return { ...scenario, attempt: await latestAttempt(scenario.reservationId) }
  }

  function sessionFor(attempt, overrides = {}) {
    return {
      id: attempt.stripe_checkout_session_id,
      object: 'checkout.session',
      mode: 'payment',
      status: 'complete',
      payment_status: 'paid',
      client_reference_id: attempt.id,
      amount_total: Math.round(Number(attempt.amount) * 100),
      currency: 'php',
      payment_intent: `pi_${randomUUID().replaceAll('-', '')}`,
      ...overrides,
    }
  }

  function stripeEvent(type, session, id = `evt_${randomUUID().replaceAll('-', '')}`) {
    return { id, object: 'event', type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object: session } }
  }

  async function deliver(event, { signature, rawBody } = {}) {
    const body = rawBody ?? JSON.stringify(event)
    fixture.stripeEventIds.push(event.id)
    const headers = { 'Content-Type': 'application/json' }
    const header = signature === undefined
      ? stripeSigner.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET })
      : signature
    if (header !== null) headers['Stripe-Signature'] = header
    const response = await fetch(`${fixture.baseUrl}/api/payments/stripe/webhook`, { method: 'POST', headers, body })
    return { response, payload: await response.json().catch(() => null) }
  }

  const paid = (attempt, overrides) => stripeEvent('checkout.session.completed', sessionFor(attempt, overrides))
  const webhookRow = (id) => prisma.stripe_webhook_events.findUnique({ where: { id } })

  async function expireHold(reservationId) {
    await prisma.reservations.update({ where: { id: reservationId }, data: { expires_at: new Date(Date.now() - 1000) } })
  }

  try {
    let existingRowCounts
    try {
      await prisma.$queryRaw`SELECT 1`
      existingRowCounts = await Promise.all([
        prisma.users, prisma.events, prisma.ticket_types, prisma.reservations, prisma.reservation_items,
        prisma.bookings, prisma.idempotency_keys, prisma.payment_attempts, prisma.stripe_webhook_events,
      ].map((table) => table.count()))
    } catch (error) {
      const safeCode = typeof error.code === 'string' && /^[A-Z0-9]+$/.test(error.code) ? ` (database error ${error.code})` : ''
      throw new Error(`The dedicated test database is unavailable or does not have the Encore payment tables${safeCode}. Prepare only the database named in TEST_DATABASE_URL before running integration tests.`)
    }
    if (existingRowCounts.some((count) => count > 0)) {
      throw new Error('The dedicated integration-test database must be empty before a run. Use a separate empty database; the suite does not clean pre-existing data.')
    }
    databaseReady = true
    dbClient = new Client({ connectionString: process.env.DATABASE_URL })
    await dbClient.connect()

    fixture.server = app.listen(0, '127.0.0.1')
    await new Promise((resolve, reject) => { fixture.server.once('listening', resolve); fixture.server.once('error', reject) })
    fixture.baseUrl = `http://127.0.0.1:${fixture.server.address().port}`
    fixture.account = await createAccount('Payment Customer')
    fixture.otherAccount = await createAccount('Other Customer')

    await t.test('payment mode is enforced by the backend', async () => {
      const config = await request('/api/payments/config')
      assert.deepEqual(config.payload, { success: true, data: { provider: 'stripe' } })

      const { reservationId, ticket } = await reserve()
      const key = randomUUID()
      const simulated = await request(`/api/reservations/${reservationId}/checkout`, {
        method: 'POST', cookie: fixture.account.cookie, headers: { 'Idempotency-Key': key },
      })
      assert.equal(simulated.response.status, 409)
      assert.equal((await reservationOf(reservationId)).status, 'pending')
      assert.equal((await bookingsFor(reservationId)).length, 0)
      assert.equal(await prisma.idempotency_keys.count({ where: { user_id: fixture.account.id, idempotency_key: key } }), 0)
      assert.equal(await availableOf(ticket.id), 6)

      process.env.PAYMENT_PROVIDER = 'simulated'
      try {
        assert.equal((await request('/api/payments/config')).payload.data.provider, 'simulated')
        assert.equal((await startPayment(reservationId)).response.status, 404)
        assert.equal((await deliver(stripeEvent('checkout.session.completed', {}))).response.status, 404)
        const allowed = await request(`/api/reservations/${reservationId}/checkout`, {
          method: 'POST', cookie: fixture.account.cookie, headers: { 'Idempotency-Key': randomUUID() },
        })
        assert.equal(allowed.response.status, 201, 'Simulated checkout stays available when the provider is simulated.')
      } finally {
        process.env.PAYMENT_PROVIDER = 'stripe'
      }
    })

    await t.test('initiation uses server prices, extends the hold, and creates one hosted session', async () => {
      const { reservationId, attempt, quantity } = await openPayment()
      const before = fake.calls.at(-1)
      assert.equal(attempt.status, 'open')
      assert.equal(attempt.amount.toFixed(2), '24.70')
      assert.equal(attempt.currency, 'PHP')
      assert.equal(before.idempotencyKey, attempt.id)
      assert.equal(before.params.client_reference_id, attempt.id)
      assert.deepEqual(before.params.allowed_payment_method_types, ['card'])
      assert.equal(before.params.line_items.length, 1)
      assert.equal(before.params.line_items[0].price_data.unit_amount, 1235)
      assert.equal(before.params.line_items[0].price_data.currency, 'php')
      assert.equal(before.params.line_items[0].quantity, quantity)
      assert.equal(before.params.success_url, `http://localhost:5173/reservations/${reservationId}/payment/return`)
      assert.equal(before.params.metadata.reservation_id, reservationId)

      const reservation = await reservationOf(reservationId)
      const sessionMinutes = (attempt.session_expires_at - attempt.created_at) / MINUTE
      assert.ok(sessionMinutes >= 34 && sessionMinutes <= 36, 'Session lives about 35 minutes (Stripe minimum is 30).')
      const graceMinutes = (reservation.expires_at - attempt.session_expires_at) / MINUTE
      assert.ok(graceMinutes >= 4.9 && graceMinutes <= 5.1, 'The hold outlives the session by the grace period.')
      assert.ok((reservation.expires_at - reservation.created_at) / MINUTE <= 60)

      const status = await latestPayment(reservationId)
      assert.equal(status.payload.data.payment.status, 'open')
      assert.equal(status.payload.data.payment.checkout_url, attempt.checkout_url)
      assert.equal(Object.hasOwn(status.payload.data.payment, 'stripe_checkout_session_id'), false)
      assert.equal(Object.hasOwn(status.payload.data.payment, 'stripe_payment_intent_id'), false)
    })

    await t.test('client-supplied amounts are ignored', async () => {
      const scenario = await reserve()
      const started = await startPayment(scenario.reservationId, fixture.account, { amount: 1, unit_price: '0.01', total_amount: '0.01' })
      assert.equal(started.response.status, 201)
      assert.equal(started.payload.data.payment.amount, '24.70')
      assert.equal(fake.calls.at(-1).params.line_items[0].price_data.unit_amount, 1235)
    })

    await t.test('duplicate and concurrent initiation requests share one attempt and one session', async () => {
      const { reservationId, attempt } = await openPayment()
      const again = await startPayment(reservationId)
      assert.equal(again.response.status, 200)
      assert.equal(again.payload.data.payment.id, attempt.id)
      assert.equal(again.payload.data.payment.checkout_url, attempt.checkout_url)

      const concurrent = await reserve()
      const barrier = makeBarrier(2)
      const results = await Promise.all([
        barrier(() => startPayment(concurrent.reservationId)),
        barrier(() => startPayment(concurrent.reservationId)),
      ])
      assert.deepEqual(results.map((result) => result.response.status).sort(), [200, 201])
      const attempts = await attemptsFor(concurrent.reservationId)
      assert.equal(attempts.length, 1)
      assert.equal(new Set(results.map((result) => result.payload.data.payment.checkout_url)).size, 1)
      assert.equal(new Set(fake.calls.filter((call) => call.idempotencyKey === attempts[0].id).map(() => attempts[0].id)).size, 1)
    })

    await t.test('initiation rejects other owners, unusable reservations, started events, and the hold cap', async () => {
      const scenario = await reserve()
      assert.equal((await startPayment(scenario.reservationId, fixture.otherAccount)).response.status, 404)
      assert.equal((await latestPayment(scenario.reservationId, fixture.otherAccount)).response.status, 404)
      assert.equal((await request(`/api/reservations/${scenario.reservationId}/payments`, { method: 'POST' })).response.status, 401)
      assert.equal((await attemptsFor(scenario.reservationId)).length, 0)
      assert.equal((await latestPayment(scenario.reservationId)).payload.data.payment, null)

      // Expired hold: cleanup runs first, so no attempt is created and no extension happens.
      const expired = await reserve()
      await expireHold(expired.reservationId)
      assert.equal((await startPayment(expired.reservationId)).response.status, 409)
      assert.equal((await attemptsFor(expired.reservationId)).length, 0)
      assert.equal((await reservationOf(expired.reservationId)).status, 'expired')
      assert.equal(await availableOf(expired.ticket.id), 8, 'Inventory is restored once.')

      const started = await reserve()
      await prisma.events.update({ where: { id: started.event.id }, data: { starts_at: new Date(Date.now() - 1000) } })
      const holdBefore = (await reservationOf(started.reservationId)).expires_at
      assert.equal((await startPayment(started.reservationId)).response.status, 409)
      assert.equal((await attemptsFor(started.reservationId)).length, 0)
      assert.equal((await reservationOf(started.reservationId)).expires_at.getTime(), holdBefore.getTime())

      // A reservation older than the cap cannot be stretched further.
      const old = await reserve()
      await prisma.reservations.update({
        where: { id: old.reservationId },
        data: { created_at: new Date(Date.now() - 30 * MINUTE), expires_at: new Date(Date.now() + 5 * MINUTE) },
      })
      const oldHold = (await reservationOf(old.reservationId)).expires_at
      assert.equal((await startPayment(old.reservationId)).response.status, 409)
      assert.equal((await attemptsFor(old.reservationId)).length, 0)
      assert.equal((await reservationOf(old.reservationId)).expires_at.getTime(), oldHold.getTime())

      const cancelled = await reserve()
      assert.equal((await request(`/api/reservations/${cancelled.reservationId}/cancel`, { method: 'POST', cookie: fixture.account.cookie })).response.status, 200)
      assert.equal((await startPayment(cancelled.reservationId)).response.status, 409)
    })

    await t.test('a paid or under-review reservation cannot be paid for again', async () => {
      // needs_review: the reservation stays pending after an amount mismatch.
      const review = await openPayment()
      await deliver(paid(review.attempt, { amount_total: 1 }))
      assert.equal((await latestAttempt(review.reservationId)).status, 'needs_review')
      assert.equal((await reservationOf(review.reservationId)).status, 'pending')
      const holdBefore = (await reservationOf(review.reservationId)).expires_at
      const callsBefore = fake.calls.length
      const again = await startPayment(review.reservationId)
      assert.equal(again.response.status, 409)
      assert.match(again.payload.message, /under review/)
      assert.equal((await attemptsFor(review.reservationId)).length, 1)
      assert.equal(fake.calls.length, callsBefore, 'No Stripe session is created.')
      assert.equal((await reservationOf(review.reservationId)).expires_at.getTime(), holdBefore.getTime())
      const status = await latestPayment(review.reservationId)
      assert.equal(status.payload.data.payment.status, 'needs_review')
      assert.equal(status.payload.data.payment.checkout_url, null)

      // fulfilled: the reservation is confirmed and its booking exists.
      const done = await openPayment()
      await deliver(paid(done.attempt))
      const rejected = await startPayment(done.reservationId)
      assert.equal(rejected.response.status, 409)
      assert.match(rejected.payload.message, /already been paid/)
      assert.equal((await attemptsFor(done.reservationId)).length, 1)
      assert.equal((await bookingsFor(done.reservationId)).length, 1)
    })

    await t.test('a payment racing a new initiation never leaves a live attempt beside a recorded payment', async () => {
      const racing = await openPayment()
      // The first session lapsed, so a new attempt is allowed while its late payment is in flight.
      await prisma.payment_attempts.update({ where: { id: racing.attempt.id }, data: { status: 'expired' } })
      const barrier = makeBarrier(2)
      const [delivered, started] = await Promise.all([
        barrier(() => deliver(paid(racing.attempt))),
        barrier(() => startPayment(racing.reservationId)),
      ])
      assert.equal(delivered.response.status, 200)
      assert.ok([201, 409].includes(started.response.status), `unexpected initiation status ${started.response.status}`)
      const attempts = await attemptsFor(racing.reservationId)
      assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1)
      assert.equal(attempts.filter((attempt) => ['creating', 'open'].includes(attempt.status)).length, 0)
      assert.equal((await bookingsFor(racing.reservationId)).length, 1)
      assert.equal((await reservationOf(racing.reservationId)).status, 'confirmed')
    })

    await t.test('live-mode webhook events are rejected before any database write', async () => {
      const { reservationId, attempt } = await openPayment()
      const liveEvent = { ...paid(attempt), livemode: true }
      const rejected = await deliver(liveEvent)
      assert.equal(rejected.response.status, 400)
      assert.equal(await webhookRow(liveEvent.id), null)
      assert.equal((await latestAttempt(reservationId)).status, 'open')
      assert.equal((await bookingsFor(reservationId)).length, 0)
      assert.equal((await reservationOf(reservationId)).status, 'pending')

      const missingFlag = paid(attempt)
      delete missingFlag.livemode
      assert.equal((await deliver(missingFlag)).response.status, 400)
      assert.equal(await webhookRow(missingFlag.id), null)

      // The same payment as a test-mode event is accepted.
      assert.equal((await deliver(paid(attempt))).response.status, 200)
      assert.equal((await latestAttempt(reservationId)).status, 'fulfilled')
    })

    await t.test('payment cannot start unless the event begins after the session would end', async () => {
      // Reserve against a distant event, then move the start: reserving checks the database
      // clock, while payment initiation compares application-time instants only.
      async function reserveStartingIn(minutes) {
        const scenario = await reserve()
        await prisma.events.update({ where: { id: scenario.event.id }, data: { starts_at: new Date(Date.now() + minutes * MINUTE) } })
        return scenario
      }

      const tooSoon = await reserveStartingIn(34)
      const holdBefore = (await reservationOf(tooSoon.reservationId)).expires_at
      const rejected = await startPayment(tooSoon.reservationId)
      assert.equal(rejected.response.status, 409)
      assert.match(rejected.payload.message, /starts too soon/)
      assert.equal((await attemptsFor(tooSoon.reservationId)).length, 0)
      assert.equal((await reservationOf(tooSoon.reservationId)).expires_at.getTime(), holdBefore.getTime())

      const justEnough = await reserveStartingIn(36)
      assert.equal((await startPayment(justEnough.reservationId)).response.status, 201)
      const attempt = await latestAttempt(justEnough.reservationId)
      const startsAt = (await prisma.events.findUnique({ where: { id: justEnough.event.id } })).starts_at
      assert.ok(startsAt.getTime() > attempt.session_expires_at.getTime())

      // An event that starts at or before the session end is refused, including one already underway.
      const boundary = await reserveStartingIn(35)
      await prisma.events.update({ where: { id: boundary.event.id }, data: { starts_at: new Date(Date.now() + 35 * MINUTE - 1000) } })
      assert.equal((await startPayment(boundary.reservationId)).response.status, 409)
      const underway = await reserveStartingIn(-1)
      const underwayResult = await startPayment(underway.reservationId)
      assert.equal(underwayResult.response.status, 409)
      assert.match(underwayResult.payload.message, /already started/)
      assert.equal((await attemptsFor(underway.reservationId)).length, 0)
    })

    await t.test('a retry sends identical parameters even after the event and ticket are renamed', async () => {
      const scenario = await reserve()
      fake.failure = 'lost-response'
      assert.equal((await startPayment(scenario.reservationId)).response.status, 502)
      const created = await latestAttempt(scenario.reservationId)
      assert.equal(created.status, 'creating')
      assert.equal(Array.isArray(created.checkout_items), true)
      assert.equal(created.checkout_items[0].unit_amount, 1235)
      const originalName = created.checkout_items[0].name

      await prisma.events.update({ where: { id: scenario.event.id }, data: { title: 'Renamed by an administrator' } })
      await prisma.ticket_types.update({ where: { id: scenario.ticket.id }, data: { name: 'Renamed ticket' } })

      const retry = await startPayment(scenario.reservationId)
      assert.equal(retry.response.status, 200)
      const calls = fake.calls.filter((call) => call.idempotencyKey === created.id)
      assert.equal(calls.length, 2)
      assert.deepEqual(calls[0].params, calls[1].params)
      assert.equal(calls[1].params.line_items[0].price_data.product_data.name, originalName)
      assert.equal(originalName.includes('Renamed'), false)
      const attempt = await latestAttempt(scenario.reservationId)
      assert.equal(attempt.status, 'open')
      assert.equal(fake.sessions.get(created.id).session.id, attempt.stripe_checkout_session_id)
    })

    await t.test('an idempotency parameter mismatch leaves the attempt unchanged', async () => {
      const scenario = await reserve()
      fake.failure = 'idempotency-mismatch'
      const mismatch = await startPayment(scenario.reservationId)
      assert.equal(mismatch.response.status, 409)
      let attempts = await attemptsFor(scenario.reservationId)
      assert.equal(attempts.length, 1)
      assert.equal(attempts[0].status, 'creating', 'The attempt is not marked expired or failed.')
      assert.equal(attempts[0].stripe_checkout_session_id, null)

      // Once Stripe accepts the same request again, the same attempt completes.
      const retry = await startPayment(scenario.reservationId)
      assert.equal(retry.response.status, 200)
      attempts = await attemptsFor(scenario.reservationId)
      assert.equal(attempts.length, 1)
      assert.equal(attempts[0].status, 'open')
    })

    await t.test('a lost Stripe response is recovered with the same idempotency key and parameters', async () => {
      const scenario = await reserve()
      fake.failure = 'lost-response'
      const first = await startPayment(scenario.reservationId)
      assert.equal(first.response.status, 502)
      let attempt = await latestAttempt(scenario.reservationId)
      assert.equal(attempt.status, 'creating')
      assert.equal(attempt.stripe_checkout_session_id, null)

      const retry = await startPayment(scenario.reservationId)
      assert.equal(retry.response.status, 200)
      attempt = await latestAttempt(scenario.reservationId)
      assert.equal(attempt.status, 'open')
      assert.equal((await attemptsFor(scenario.reservationId)).length, 1)
      const calls = fake.calls.filter((call) => call.idempotencyKey === attempt.id)
      assert.equal(calls.length, 2)
      assert.deepEqual(calls[0].params, calls[1].params)
      assert.equal(fake.sessions.get(attempt.id).session.id, attempt.stripe_checkout_session_id, 'The replayed session is the one Stripe created.')
    })

    await t.test('a stale creating attempt is closed and a rejected creation frees the reservation', async () => {
      const scenario = await reserve()
      fake.failure = 'lost-response'
      assert.equal((await startPayment(scenario.reservationId)).response.status, 502)
      const stale = await latestAttempt(scenario.reservationId)
      // Simulate five minutes passing: the saved session lifetime can no longer be replayed.
      await prisma.payment_attempts.update({ where: { id: stale.id }, data: { session_expires_at: new Date(Date.now() + 29 * MINUTE) } })
      const replacement = await startPayment(scenario.reservationId)
      assert.equal(replacement.response.status, 201)
      const attempts = await attemptsFor(scenario.reservationId)
      assert.equal(attempts.length, 2)
      assert.equal(attempts[0].status, 'expired')
      assert.equal(attempts[1].status, 'open')
      assert.equal(attempts.filter((attempt) => ['creating', 'open'].includes(attempt.status)).length, 1)

      const rejected = await reserve()
      fake.failure = 'invalid'
      assert.equal((await startPayment(rejected.reservationId)).response.status, 502)
      assert.equal((await latestAttempt(rejected.reservationId)).status, 'failed')
      const second = await startPayment(rejected.reservationId)
      assert.equal(second.response.status, 201)
      assert.equal((await attemptsFor(rejected.reservationId)).length, 2)
    })

    await t.test('cancellation is blocked while a payment is live and expiry closes abandoned attempts', async () => {
      const { reservationId, ticket, attempt } = await openPayment()
      const blocked = await request(`/api/reservations/${reservationId}/cancel`, { method: 'POST', cookie: fixture.account.cookie })
      assert.equal(blocked.response.status, 409)
      assert.equal((await reservationOf(reservationId)).status, 'pending')
      assert.equal(await availableOf(ticket.id), 6)

      await expireHold(reservationId)
      const list = await request('/api/reservations', { cookie: fixture.account.cookie })
      assert.equal(list.response.status, 200)
      assert.equal((await reservationOf(reservationId)).status, 'expired')
      assert.equal((await prisma.payment_attempts.findUnique({ where: { id: attempt.id } })).status, 'expired')
      assert.equal(await availableOf(ticket.id), 8, 'Inventory is restored exactly once.')
      await request('/api/reservations', { cookie: fixture.account.cookie })
      assert.equal(await availableOf(ticket.id), 8)
    })

    const cancelPayment = (reservationId, account = fixture.account) => request(`/api/reservations/${reservationId}/payments/cancel`, {
      method: 'POST', cookie: account.cookie,
    })
    const sessionStatus = (attempt) => fake.byId.get(attempt.stripe_checkout_session_id).status

    await t.test('cancelling an open payment expires the Stripe session, then the attempt, and is repeatable', async () => {
      const { reservationId, ticket, attempt } = await openPayment()
      const cancelled = await cancelPayment(reservationId)
      assert.equal(cancelled.response.status, 200)
      assert.equal(cancelled.payload.data.outcome, 'cancelled')
      assert.equal(cancelled.payload.data.payment.status, 'expired')
      assert.equal(cancelled.payload.data.payment.checkout_url, null)
      assert.deepEqual(fake.expireCalls.filter((id) => id === attempt.stripe_checkout_session_id), [attempt.stripe_checkout_session_id])
      assert.equal(sessionStatus(attempt), 'expired')
      assert.equal((await latestAttempt(reservationId)).status, 'expired')
      assert.equal((await reservationOf(reservationId)).status, 'pending')
      assert.equal((await bookingsFor(reservationId)).length, 0)
      assert.equal(await availableOf(ticket.id), 6, 'Cancelling a payment does not release the tickets.')

      // Repeating the request has no further side effects.
      const expireCallsBefore = fake.expireCalls.length
      const repeated = await cancelPayment(reservationId)
      assert.equal(repeated.response.status, 200)
      assert.equal(repeated.payload.data.outcome, 'no-live-payment')
      assert.equal(repeated.payload.data.payment.status, 'expired')
      assert.equal(fake.expireCalls.length, expireCallsBefore)

      // The customer can now cancel the reservation, which restores inventory exactly once.
      const reservationCancel = await request(`/api/reservations/${reservationId}/cancel`, { method: 'POST', cookie: fixture.account.cookie })
      assert.equal(reservationCancel.response.status, 200)
      assert.equal(await availableOf(ticket.id), 8)
      assert.equal((await bookingsFor(reservationId)).length, 0)

      // Or retry payment with a fresh session on another reservation.
      const retry = await openPayment()
      assert.equal((await cancelPayment(retry.reservationId)).response.status, 200)
      const second = await startPayment(retry.reservationId)
      assert.equal(second.response.status, 201)
      assert.notEqual(second.payload.data.payment.id, retry.attempt.id)
    })

    await t.test('two simultaneous cancellations expire the session once and both succeed', async () => {
      const { reservationId, attempt } = await openPayment()
      const barrier = makeBarrier(2)
      const results = await Promise.all([barrier(() => cancelPayment(reservationId)), barrier(() => cancelPayment(reservationId))])
      assert.deepEqual(results.map((result) => result.response.status), [200, 200])
      assert.equal(sessionStatus(attempt), 'expired')
      const attempts = await attemptsFor(reservationId)
      assert.equal(attempts.length, 1)
      assert.equal(attempts[0].status, 'expired')
    })

    await t.test('a session Stripe already expired counts as cancelled', async () => {
      const { reservationId, attempt } = await openPayment()
      fake.setSessionStatus(attempt.stripe_checkout_session_id, 'expired')
      const cancelled = await cancelPayment(reservationId)
      assert.equal(cancelled.response.status, 200)
      assert.equal(cancelled.payload.data.outcome, 'cancelled')
      assert.equal((await latestAttempt(reservationId)).status, 'expired')
    })

    await t.test('a session Stripe reports as complete is left for the webhook and returns 409', async () => {
      const { reservationId, ticket, attempt } = await openPayment()
      fake.setSessionStatus(attempt.stripe_checkout_session_id, 'complete')
      const rejected = await cancelPayment(reservationId)
      assert.equal(rejected.response.status, 409)
      assert.match(rejected.payload.message, /already been completed or is being processed/)
      assert.equal((await latestAttempt(reservationId)).status, 'open', 'Local state is unchanged.')
      assert.equal((await bookingsFor(reservationId)).length, 0)
      assert.equal((await reservationOf(reservationId)).status, 'pending')
      // The reservation cannot be cancelled either while that payment may still be recorded.
      assert.equal((await request(`/api/reservations/${reservationId}/cancel`, { method: 'POST', cookie: fixture.account.cookie })).response.status, 409)

      // The webhook remains authoritative and fulfils the booking.
      assert.equal((await deliver(paid(attempt))).response.status, 200)
      assert.equal((await latestAttempt(reservationId)).status, 'fulfilled')
      assert.equal((await bookingsFor(reservationId)).length, 1)
      assert.equal(await availableOf(ticket.id), 6)
    })

    await t.test('Stripe or network failures leave local state unchanged and return a retryable 502', async () => {
      const { reservationId, attempt } = await openPayment()
      for (const failure of ['network', 'server']) {
        fake.expireFailure = failure
        const failed = await cancelPayment(reservationId)
        assert.equal(failed.response.status, 502, failure)
        assert.equal((await latestAttempt(reservationId)).status, 'open')
        assert.equal(sessionStatus(attempt), 'open')
      }
      // Stripe refuses the expiry and then the follow-up lookup also fails: outcome unknown.
      fake.setSessionStatus(attempt.stripe_checkout_session_id, 'complete')
      fake.retrieveFailure = true
      assert.equal((await cancelPayment(reservationId)).response.status, 502)
      assert.equal((await latestAttempt(reservationId)).status, 'open')
      fake.setSessionStatus(attempt.stripe_checkout_session_id, 'open')

      // The same request succeeds once Stripe is reachable again.
      const retried = await cancelPayment(reservationId)
      assert.equal(retried.response.status, 200)
      assert.equal(retried.payload.data.outcome, 'cancelled')
      assert.equal(sessionStatus(attempt), 'expired')
    })

    await t.test('cancelling races with a successful webhook without overwriting the payment', async () => {
      // Payment lands while the expire call is in flight and Stripe reports the session complete.
      // No database lock is held during the Stripe call, so the webhook can run to completion.
      const first = await openPayment()
      fake.onExpire = async () => {
        fake.setSessionStatus(first.attempt.stripe_checkout_session_id, 'complete')
        assert.equal((await deliver(paid(first.attempt))).response.status, 200)
      }
      const rejected = await cancelPayment(first.reservationId)
      assert.equal(rejected.response.status, 409)
      assert.equal((await latestAttempt(first.reservationId)).status, 'fulfilled')
      assert.equal((await bookingsFor(first.reservationId)).length, 1)
      assert.equal(await availableOf(first.ticket.id), 6)

      // Even if Stripe wrongly confirmed the expiry, a recorded payment is never overwritten.
      const second = await openPayment()
      fake.onExpire = async () => {
        assert.equal((await deliver(paid(second.attempt))).response.status, 200)
      }
      const guarded = await cancelPayment(second.reservationId)
      assert.equal(guarded.response.status, 409)
      assert.equal((await latestAttempt(second.reservationId)).status, 'fulfilled')
      assert.equal((await bookingsFor(second.reservationId)).length, 1)
      assert.equal((await reservationOf(second.reservationId)).status, 'confirmed')
    })

    await t.test('a payment recorded for review is not touched by cancellation', async () => {
      const review = await openPayment()
      await deliver(paid(review.attempt, { amount_total: 1 }))
      assert.equal((await latestAttempt(review.reservationId)).status, 'needs_review')
      const expireCallsBefore = fake.expireCalls.length
      const result = await cancelPayment(review.reservationId)
      assert.equal(result.response.status, 200)
      assert.equal(result.payload.data.outcome, 'no-live-payment')
      assert.equal(result.payload.data.payment.status, 'needs_review')
      assert.equal(fake.expireCalls.length, expireCallsBefore)
      assert.equal((await latestAttempt(review.reservationId)).status, 'needs_review')
    })

    await t.test('without a live attempt, cancellation is a successful no-op and ownership is enforced', async () => {
      const scenario = await reserve()
      const none = await cancelPayment(scenario.reservationId)
      assert.equal(none.response.status, 200)
      assert.deepEqual(none.payload.data, { outcome: 'no-live-payment', payment: null })
      assert.equal((await cancelPayment(scenario.reservationId, fixture.otherAccount)).response.status, 404)
      assert.equal((await request(`/api/reservations/${scenario.reservationId}/payments/cancel`, { method: 'POST' })).response.status, 401)
      assert.equal((await request('/api/reservations/not-a-uuid/payments/cancel', { method: 'POST', cookie: fixture.account.cookie })).response.status, 400)

      // The other user cannot close someone else's open session.
      const open = await openPayment()
      assert.equal((await cancelPayment(open.reservationId, fixture.otherAccount)).response.status, 404)
      assert.equal(sessionStatus(open.attempt), 'open')

      process.env.PAYMENT_PROVIDER = 'simulated'
      try {
        assert.equal((await cancelPayment(open.reservationId)).response.status, 404)
      } finally {
        process.env.PAYMENT_PROVIDER = 'stripe'
      }
    })

    await t.test('cancelling while a session is being created waits for it, and a stale creation is closed safely', async () => {
      // Request A is inside Stripe's create call (held at a gate). Cancel must not claim success.
      const slow = await reserve()
      let release
      fake.gate = new Promise((resolve) => { release = resolve })
      const starting = startPayment(slow.reservationId)
      const deadline = Date.now() + 5000
      while (fake.inflight.size === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
      assert.equal(fake.inflight.size, 1, 'The session creation is in flight.')
      const during = await cancelPayment(slow.reservationId)
      assert.equal(during.response.status, 409, 'The in-use idempotency key is reported, not treated as cancelled.')
      assert.equal((await latestAttempt(slow.reservationId)).status, 'creating')
      fake.gate = null
      release()
      const started = await starting
      assert.equal(started.response.status, 201)
      assert.equal((await latestAttempt(slow.reservationId)).status, 'open')
      const afterwards = await cancelPayment(slow.reservationId)
      assert.equal(afterwards.response.status, 200)
      assert.equal(afterwards.payload.data.outcome, 'cancelled')
      assert.equal(fake.sessions.size > 0, true)
      assert.equal(fake.byId.get((await latestAttempt(slow.reservationId)).stripe_checkout_session_id).status, 'expired')

      // The response to the create call was lost, so the session ID is unknown: finish creating it
      // with the same key, then expire it. Nothing is left payable.
      const lost = await reserve()
      fake.failure = 'lost-response'
      assert.equal((await startPayment(lost.reservationId)).response.status, 502)
      const creating = await latestAttempt(lost.reservationId)
      assert.equal(creating.status, 'creating')
      const resumed = await cancelPayment(lost.reservationId)
      assert.equal(resumed.response.status, 200)
      assert.equal(resumed.payload.data.outcome, 'cancelled')
      const closed = await latestAttempt(lost.reservationId)
      assert.equal(closed.status, 'expired')
      assert.equal(closed.stripe_checkout_session_id, fake.sessions.get(creating.id).session.id)
      assert.equal(fake.byId.get(closed.stripe_checkout_session_id).status, 'expired')
      assert.equal(fake.calls.filter((call) => call.idempotencyKey === creating.id).length, 2)

      // If Stripe cannot be reached while resuming, nothing is claimed and nothing changes.
      const offline = await reserve()
      fake.failure = 'lost-response'
      assert.equal((await startPayment(offline.reservationId)).response.status, 502)
      fake.failure = 'network'
      assert.equal((await cancelPayment(offline.reservationId)).response.status, 502)
      assert.equal((await latestAttempt(offline.reservationId)).status, 'creating')
      assert.equal((await cancelPayment(offline.reservationId)).response.status, 200, 'The retry succeeds.')

      // Too old to finish creating, and no URL was ever returned: closed without calling Stripe.
      const stale = await reserve()
      fake.failure = 'lost-response'
      assert.equal((await startPayment(stale.reservationId)).response.status, 502)
      const staleAttempt = await latestAttempt(stale.reservationId)
      await prisma.payment_attempts.update({ where: { id: staleAttempt.id }, data: { session_expires_at: new Date(Date.now() + 29 * MINUTE) } })
      const callsBefore = fake.calls.length
      const expireCallsBefore = fake.expireCalls.length
      const staleResult = await cancelPayment(stale.reservationId)
      assert.equal(staleResult.response.status, 200)
      assert.equal((await latestAttempt(stale.reservationId)).status, 'expired')
      assert.equal(fake.calls.length, callsBefore)
      assert.equal(fake.expireCalls.length, expireCallsBefore)
    })

    // An open attempt whose time has run out on this server's clock. Only Stripe can say whether the
    // session can still be paid, so replacing it must wait for Stripe's answer.
    async function openElapsed() {
      const scenario = await openPayment()
      await prisma.payment_attempts.update({ where: { id: scenario.attempt.id }, data: { session_expires_at: new Date(Date.now() - MINUTE) } })
      return scenario
    }

    // Elapsed sessions are never replaced: a new session can no longer fit inside the 60-minute hold cap.
    function assertSessionEnded(result) {
      assert.equal(result.response.status, 409)
      assert.match(result.payload.message, /payment session has ended/)
    }

    await t.test('an elapsed open attempt is closed only after Stripe confirms the old session expired, and is not replaced', async () => {
      const scenario = await openElapsed()
      const sessionId = scenario.attempt.stripe_checkout_session_id
      fake.setSessionStatus(sessionId, 'expired')
      const callsBefore = fake.calls.length
      assertSessionEnded(await startPayment(scenario.reservationId))
      const attempts = await attemptsFor(scenario.reservationId)
      assert.deepEqual(attempts.map((attempt) => attempt.status), ['expired'])
      assert.equal(attempts[0].stripe_checkout_session_id, sessionId)
      assert.equal(fake.calls.length, callsBefore, 'No replacement Checkout Session is created.')
      assert.equal((await reservationOf(scenario.reservationId)).status, 'pending', 'The hold itself is left to expire.')
      assert.equal(await availableOf(scenario.ticket.id), 6)

      // The webhook that reports the same expiry arriving first changes nothing about the outcome.
      const raced = await openElapsed()
      fake.setSessionStatus(raced.attempt.stripe_checkout_session_id, 'expired')
      fake.onRetrieve = async () => {
        const expiredEvent = stripeEvent('checkout.session.expired', sessionFor(raced.attempt, { status: 'expired', payment_status: 'unpaid' }))
        assert.equal((await deliver(expiredEvent)).response.status, 200)
      }
      const racedCalls = fake.calls.length
      assertSessionEnded(await startPayment(raced.reservationId))
      const racedAttempts = await attemptsFor(raced.reservationId)
      assert.deepEqual(racedAttempts.map((attempt) => attempt.status), ['expired'])
      assert.equal(fake.calls.length, racedCalls)
    })

    await t.test('an elapsed open attempt whose session Stripe still reports open is reused, not replaced', async () => {
      const scenario = await openElapsed()
      const callsBefore = fake.calls.length
      const expireCallsBefore = fake.expireCalls.length
      const reused = await startPayment(scenario.reservationId)
      assert.equal(reused.response.status, 200)
      assert.equal(reused.payload.data.payment.id, scenario.attempt.id)
      assert.equal(reused.payload.data.payment.checkout_url, scenario.attempt.checkout_url)
      assert.equal((await attemptsFor(scenario.reservationId)).length, 1)
      assert.equal(fake.calls.length, callsBefore, 'No second Checkout Session is created.')
      assert.equal(fake.expireCalls.length, expireCallsBefore, 'The open session is not closed either.')
      assert.equal((await latestAttempt(scenario.reservationId)).status, 'open')
    })

    await t.test('an elapsed open attempt whose session is complete is left to the webhook', async () => {
      const scenario = await openElapsed()
      fake.setSessionStatus(scenario.attempt.stripe_checkout_session_id, 'complete')
      const callsBefore = fake.calls.length
      const rejected = await startPayment(scenario.reservationId)
      assert.equal(rejected.response.status, 409)
      assert.match(rejected.payload.message, /already been completed or is being processed/)
      assert.equal((await attemptsFor(scenario.reservationId)).length, 1)
      assert.equal((await latestAttempt(scenario.reservationId)).status, 'open')
      assert.equal(fake.calls.length, callsBefore)

      // The webhook then fulfils it as usual.
      assert.equal((await deliver(paid(scenario.attempt))).response.status, 200)
      assert.equal((await latestAttempt(scenario.reservationId)).status, 'fulfilled')
      assert.equal((await bookingsFor(scenario.reservationId)).length, 1)

      // A payment recorded while Encore is asking Stripe wins over a stale 'expired' answer.
      const racing = await openElapsed()
      fake.onRetrieve = async () => {
        assert.equal((await deliver(paid(racing.attempt))).response.status, 200)
        fake.setSessionStatus(racing.attempt.stripe_checkout_session_id, 'expired')
      }
      const guarded = await startPayment(racing.reservationId)
      assert.equal(guarded.response.status, 409)
      const racingAttempts = await attemptsFor(racing.reservationId)
      assert.equal(racingAttempts.length, 1)
      assert.equal(racingAttempts[0].status, 'fulfilled')
      assert.equal((await bookingsFor(racing.reservationId)).length, 1)
    })

    await t.test('an elapsed open attempt with an unknown Stripe state is neither replaced nor duplicated', async () => {
      const scenario = await openElapsed()
      const callsBefore = fake.calls.length
      fake.retrieveFailure = true
      const unknown = await startPayment(scenario.reservationId)
      assert.equal(unknown.response.status, 502)
      assert.equal((await attemptsFor(scenario.reservationId)).length, 1)
      assert.equal((await latestAttempt(scenario.reservationId)).status, 'open')
      assert.equal(fake.calls.length, callsBefore)

      // An unrecognised status value is also treated as unknown.
      fake.setSessionStatus(scenario.attempt.stripe_checkout_session_id, 'unrecognised')
      assert.equal((await startPayment(scenario.reservationId)).response.status, 502)
      assert.equal((await attemptsFor(scenario.reservationId)).length, 1)
      assert.equal(fake.calls.length, callsBefore)

      // Once Stripe answers clearly, the attempt is closed and the request gets a definite answer.
      fake.setSessionStatus(scenario.attempt.stripe_checkout_session_id, 'expired')
      assertSessionEnded(await startPayment(scenario.reservationId))
      assert.deepEqual((await attemptsFor(scenario.reservationId)).map((attempt) => attempt.status), ['expired'])
      assert.equal(fake.calls.length, callsBefore)
    })

    // The same scenario on a real timeline, with no row edited by the test: this process's clock (shared
    // with the in-process API) is moved past the session's end, inside the 5-minute hold grace period.
    async function withClockOffset(minutes, run) {
      const RealDate = Date
      class ShiftedDate extends RealDate {
        constructor(...args) { super(...(args.length === 0 ? [RealDate.now() + minutes * MINUTE] : args)) }
        static now() { return RealDate.now() + minutes * MINUTE }
        static [Symbol.hasInstance](value) { return value instanceof RealDate }
      }
      global.Date = ShiftedDate
      try { return await run() } finally { global.Date = RealDate }
    }

    await t.test('on a real timeline an elapsed session is reused while Stripe has it open and never replaced once it expired', async () => {
      const scenario = await openPayment()
      const before = await reservationOf(scenario.reservationId)
      const sessionId = scenario.attempt.stripe_checkout_session_id
      const callsBefore = fake.calls.length

      // 36 minutes later: past the 35-minute session, before the 40-minute hold ends.
      const reused = await withClockOffset(36, () => startPayment(scenario.reservationId))
      assert.equal(reused.response.status, 200, 'Stripe still reports the session open, so it is reused.')
      assert.equal(reused.payload.data.payment.id, scenario.attempt.id)
      assert.equal(reused.payload.data.payment.checkout_url, scenario.attempt.checkout_url)

      fake.setSessionStatus(sessionId, 'expired')
      assertSessionEnded(await withClockOffset(36, () => startPayment(scenario.reservationId)))
      const attempts = await attemptsFor(scenario.reservationId)
      assert.deepEqual(attempts.map((attempt) => attempt.status), ['expired'])
      assert.equal(attempts[0].stripe_checkout_session_id, sessionId)
      assert.equal(fake.calls.length, callsBefore, 'No replacement Checkout Session is created.')
      const after = await reservationOf(scenario.reservationId)
      assert.equal(after.status, 'pending')
      assert.equal(after.expires_at.getTime(), before.expires_at.getTime(), 'The hold is neither extended nor released early.')
      assert.ok((after.expires_at - after.created_at) / MINUTE <= 60, 'The hold cap still applies.')
      assert.equal(await availableOf(scenario.ticket.id), 6)
    })

    await t.test('the resume threshold is 32 minutes of remaining session lifetime', async () => {
      // Creation fails before Stripe stores anything, leaving a `creating` attempt to resume or replace.
      async function creatingAttempt() {
        const scenario = await reserve()
        fake.failure = 'network'
        assert.equal((await startPayment(scenario.reservationId)).response.status, 502)
        const attempt = await latestAttempt(scenario.reservationId)
        assert.equal(attempt.status, 'creating')
        return { scenario, attempt }
      }

      // Just above the threshold: the same attempt is resumed.
      const above = await creatingAttempt()
      await prisma.payment_attempts.update({ where: { id: above.attempt.id }, data: { session_expires_at: new Date(Date.now() + 32 * MINUTE + 10_000) } })
      const resumed = await startPayment(above.scenario.reservationId)
      assert.equal(resumed.response.status, 200)
      assert.equal(resumed.payload.data.payment.id, above.attempt.id)
      assert.equal((await attemptsFor(above.scenario.reservationId)).length, 1)

      // Just below it: closed as stale and replaced, with no call for the old attempt.
      const below = await creatingAttempt()
      await prisma.payment_attempts.update({ where: { id: below.attempt.id }, data: { session_expires_at: new Date(Date.now() + 32 * MINUTE - 10_000) } })
      const callsBefore = fake.calls.length
      const replaced = await startPayment(below.scenario.reservationId)
      assert.equal(replaced.response.status, 201)
      const attempts = await attemptsFor(below.scenario.reservationId)
      assert.deepEqual(attempts.map((attempt) => attempt.status), ['expired', 'open'])
      assert.equal(fake.calls.length, callsBefore + 1, 'Only the replacement session is created.')

      // The same threshold applies to cancellation.
      const cancelAbove = await creatingAttempt()
      await prisma.payment_attempts.update({ where: { id: cancelAbove.attempt.id }, data: { session_expires_at: new Date(Date.now() + 32 * MINUTE + 10_000) } })
      const resumedCancel = await cancelPayment(cancelAbove.scenario.reservationId)
      assert.equal(resumedCancel.response.status, 200)
      assert.equal((await latestAttempt(cancelAbove.scenario.reservationId)).stripe_checkout_session_id !== null, true, 'The session was created, then closed.')
      const cancelBelow = await creatingAttempt()
      await prisma.payment_attempts.update({ where: { id: cancelBelow.attempt.id }, data: { session_expires_at: new Date(Date.now() + 32 * MINUTE - 10_000) } })
      const staleCalls = fake.calls.length
      assert.equal((await cancelPayment(cancelBelow.scenario.reservationId)).response.status, 200)
      assert.equal(fake.calls.length, staleCalls)
      assert.equal((await latestAttempt(cancelBelow.scenario.reservationId)).stripe_checkout_session_id, null)
      assert.equal((await latestAttempt(cancelBelow.scenario.reservationId)).status, 'expired')
    })

    await t.test('verified paid events that cannot be checked safely are recorded for review, not retried forever', async () => {
      for (const amountTotal of [null, '2470', 24.7, -1, 1e21]) {
        const scenario = await openPayment()
        const event = paid(scenario.attempt, { amount_total: amountTotal })
        const delivered = await deliver(event)
        assert.equal(delivered.response.status, 200, `amount_total ${String(amountTotal)}`)
        const attempt = await latestAttempt(scenario.reservationId)
        assert.equal(attempt.status, 'needs_review')
        assert.equal(attempt.review_reason, 'amount_mismatch')
        assert.equal((await bookingsFor(scenario.reservationId)).length, 0)
        assert.equal((await reservationOf(scenario.reservationId)).status, 'pending')
        assert.equal((await webhookRow(event.id)).outcome, 'needs_review')
      }

      for (const type of ['checkout.session.completed', 'checkout.session.async_payment_succeeded']) {
        const scenario = await openPayment()
        const event = stripeEvent(type, sessionFor(scenario.attempt, { mode: 'subscription' }))
        assert.equal((await deliver(event)).response.status, 200)
        const attempt = await latestAttempt(scenario.reservationId)
        assert.equal(attempt.status, 'needs_review')
        assert.equal(attempt.review_reason, 'unexpected_session')
        assert.equal((await bookingsFor(scenario.reservationId)).length, 0)
      }
    })

    await t.test('only sessions reported as paid are fulfilled, including async success events', async () => {
      const scenario = await openPayment()
      for (const [type, overrides] of [
        ['checkout.session.async_payment_succeeded', { payment_status: 'unpaid' }],
        ['checkout.session.async_payment_succeeded', { payment_status: 'no_payment_required' }],
        ['checkout.session.completed', { payment_status: 'no_payment_required' }],
      ]) {
        const event = stripeEvent(type, sessionFor(scenario.attempt, overrides))
        assert.equal((await deliver(event)).response.status, 200)
        assert.equal((await webhookRow(event.id)).outcome, 'ignored')
      }
      assert.equal((await latestAttempt(scenario.reservationId)).status, 'open')
      assert.equal((await bookingsFor(scenario.reservationId)).length, 0)

      // A verified event without a session object is acknowledged and ignored.
      const empty = stripeEvent('checkout.session.completed', null)
      assert.equal((await deliver(empty)).response.status, 200)
      assert.equal((await webhookRow(empty.id)).outcome, 'ignored')

      // The same attempt is fulfilled by a genuine paid event.
      assert.equal((await deliver(stripeEvent('checkout.session.async_payment_succeeded', sessionFor(scenario.attempt)))).response.status, 200)
      assert.equal((await latestAttempt(scenario.reservationId)).status, 'fulfilled')
      assert.equal((await bookingsFor(scenario.reservationId)).length, 1)
    })

    await t.test('webhooks without a valid signature change nothing', async () => {
      const { reservationId, attempt } = await openPayment()
      const event = paid(attempt)
      const body = JSON.stringify(event)
      const results = [
        await deliver(event, { signature: null }),
        await deliver(event, { signature: 't=1,v1=deadbeef' }),
        await deliver(event, { signature: stripeSigner.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_wrong_secret' }) }),
        await deliver(event, { rawBody: `${body} `, signature: stripeSigner.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET }) }),
        await deliver(event, { signature: stripeSigner.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET, timestamp: Math.floor(Date.now() / 1000) - 3600 }) }),
      ]
      for (const result of results) assert.equal(result.response.status, 400)
      assert.equal(await webhookRow(event.id), null)
      assert.equal((await latestAttempt(reservationId)).status, 'open')
      assert.equal((await bookingsFor(reservationId)).length, 0)
      assert.equal((await reservationOf(reservationId)).status, 'pending')
    })

    await t.test('verified payment creates exactly one booking and records the event', async () => {
      const { reservationId, ticket, attempt } = await openPayment()
      const event = paid(attempt)
      const delivered = await deliver(event)
      assert.equal(delivered.response.status, 200)

      const fulfilled = await latestAttempt(reservationId)
      assert.equal(fulfilled.status, 'fulfilled')
      assert.ok(fulfilled.paid_at)
      assert.ok(fulfilled.stripe_payment_intent_id.startsWith('pi_'))
      const bookings = await bookingsFor(reservationId)
      assert.equal(bookings.length, 1)
      assert.equal(fulfilled.booking_id, bookings[0].id)
      assert.equal(bookings[0].total_amount.toFixed(2), '24.70')
      assert.equal((await reservationOf(reservationId)).status, 'confirmed')
      assert.equal(await availableOf(ticket.id), 6, 'Payment code does not change inventory.')
      assert.equal((await webhookRow(event.id)).outcome, 'processed')

      const status = await latestPayment(reservationId)
      assert.equal(status.payload.data.payment.status, 'fulfilled')
      assert.equal(status.payload.data.payment.booking_id, bookings[0].id)
      assert.equal(status.payload.data.payment.checkout_url, null)
      const booking = await request(`/api/bookings/${bookings[0].id}`, { cookie: fixture.account.cookie })
      assert.equal(booking.response.status, 200)

      // After fulfilment, the reservation cannot be paid for again.
      assert.equal((await startPayment(reservationId)).response.status, 409)
    })

    await t.test('duplicate and concurrent deliveries are processed once', async () => {
      const { reservationId, attempt } = await openPayment()
      const event = paid(attempt)
      assert.equal((await deliver(event)).response.status, 200)
      const replay = await deliver(event)
      assert.equal(replay.response.status, 200)
      assert.equal((await bookingsFor(reservationId)).length, 1)
      assert.equal(await prisma.stripe_webhook_events.count({ where: { id: event.id } }), 1)

      const racing = await openPayment()
      const racingEvent = paid(racing.attempt)
      const barrier = makeBarrier(2)
      const results = await Promise.all([barrier(() => deliver(racingEvent)), barrier(() => deliver(racingEvent))])
      assert.deepEqual(results.map((result) => result.response.status), [200, 200])
      assert.equal((await bookingsFor(racing.reservationId)).length, 1)
      assert.equal(await prisma.stripe_webhook_events.count({ where: { id: racingEvent.id } }), 1)
      assert.equal((await latestAttempt(racing.reservationId)).status, 'fulfilled')

      // Two different events for the same session race through the attempt row lock.
      const pair = await openPayment()
      const session = sessionFor(pair.attempt)
      const first = stripeEvent('checkout.session.completed', session)
      const second = stripeEvent('checkout.session.async_payment_succeeded', session)
      const pairBarrier = makeBarrier(2)
      const pairResults = await Promise.all([pairBarrier(() => deliver(first)), pairBarrier(() => deliver(second))])
      assert.deepEqual(pairResults.map((result) => result.response.status), [200, 200])
      assert.equal((await bookingsFor(pair.reservationId)).length, 1)
      const outcomes = [(await webhookRow(first.id)).outcome, (await webhookRow(second.id)).outcome].sort()
      assert.deepEqual(outcomes, ['ignored', 'processed'])
    })

    await t.test('a failure during fulfilment rolls everything back, including the deduplication row', async () => {
      const { reservationId, ticket, attempt } = await openPayment()
      const event = paid(attempt)
      paymentHooks.beforeRecordPayment = async ({ bookingId }) => {
        assert.ok(bookingId, 'The booking exists inside the transaction when the fault fires.')
        throw new Error('injected fulfilment failure')
      }
      try {
        const failed = await deliver(event)
        assert.equal(failed.response.status, 500)
      } finally {
        paymentHooks.beforeRecordPayment = null
      }
      assert.equal((await bookingsFor(reservationId)).length, 0)
      assert.equal((await reservationOf(reservationId)).status, 'pending')
      assert.equal((await latestAttempt(reservationId)).status, 'open')
      assert.equal(await webhookRow(event.id), null)
      assert.equal(await availableOf(ticket.id), 6)

      const redelivered = await deliver(event)
      assert.equal(redelivered.response.status, 200)
      assert.equal((await latestAttempt(reservationId)).status, 'fulfilled')
      assert.equal((await bookingsFor(reservationId)).length, 1)
    })

    await t.test('late or unfulfillable payments are recorded for review without a booking', async () => {
      // Hold expired but not yet cleaned up: the strict database-time claim fails.
      const lateHold = await openPayment()
      await expireHold(lateHold.reservationId)
      const lateEvent = paid(lateHold.attempt)
      assert.equal((await deliver(lateEvent)).response.status, 200)
      let attempt = await latestAttempt(lateHold.reservationId)
      assert.equal(attempt.status, 'needs_review')
      assert.equal(attempt.review_reason, 'reservation_expired')
      assert.ok(attempt.paid_at)
      assert.equal((await bookingsFor(lateHold.reservationId)).length, 0)
      assert.equal(await availableOf(lateHold.ticket.id), 6, 'The payment handler leaves inventory alone.')
      assert.equal((await webhookRow(lateEvent.id)).outcome, 'needs_review')
      await request('/api/reservations', { cookie: fixture.account.cookie })
      assert.equal(await availableOf(lateHold.ticket.id), 8, 'Normal expiry restores inventory exactly once.')
      await request('/api/reservations', { cookie: fixture.account.cookie })
      assert.equal(await availableOf(lateHold.ticket.id), 8)
      assert.equal((await latestPayment(lateHold.reservationId)).payload.data.payment.status, 'needs_review')

      // Session expired and the hold was released before the payment event arrived.
      const afterExpiry = await openPayment()
      await expireHold(afterExpiry.reservationId)
      await request('/api/reservations', { cookie: fixture.account.cookie })
      assert.equal((await latestAttempt(afterExpiry.reservationId)).status, 'expired')
      assert.equal((await deliver(paid(afterExpiry.attempt))).response.status, 200)
      attempt = await latestAttempt(afterExpiry.reservationId)
      assert.equal(attempt.status, 'needs_review')
      assert.equal(attempt.review_reason, 'reservation_expired')
      assert.equal(await availableOf(afterExpiry.ticket.id), 8)
      assert.equal((await bookingsFor(afterExpiry.reservationId)).length, 0)

      // Cancelled after the attempt had already lapsed.
      const cancelled = await openPayment()
      await prisma.payment_attempts.update({ where: { id: cancelled.attempt.id }, data: { status: 'expired' } })
      assert.equal((await request(`/api/reservations/${cancelled.reservationId}/cancel`, { method: 'POST', cookie: fixture.account.cookie })).response.status, 200)
      assert.equal((await deliver(paid(cancelled.attempt))).response.status, 200)
      assert.equal((await latestAttempt(cancelled.reservationId)).review_reason, 'reservation_cancelled')
      assert.equal(await availableOf(cancelled.ticket.id), 8)

      // The event started while the customer was paying: the hold is left untouched.
      const started = await openPayment()
      await prisma.events.update({ where: { id: started.event.id }, data: { starts_at: new Date(Date.now() - 1000) } })
      assert.equal((await deliver(paid(started.attempt))).response.status, 200)
      attempt = await latestAttempt(started.reservationId)
      assert.equal(attempt.review_reason, 'event_started')
      assert.equal((await reservationOf(started.reservationId)).status, 'pending')
      assert.equal((await bookingsFor(started.reservationId)).length, 0)
      assert.equal(await availableOf(started.ticket.id), 6)

      // Amount and currency must match the saved attempt.
      const wrongAmount = await openPayment()
      await deliver(paid(wrongAmount.attempt, { amount_total: 1 }))
      assert.equal((await latestAttempt(wrongAmount.reservationId)).review_reason, 'amount_mismatch')
      const wrongCurrency = await openPayment()
      await deliver(paid(wrongCurrency.attempt, { currency: 'usd' }))
      assert.equal((await latestAttempt(wrongCurrency.reservationId)).review_reason, 'currency_mismatch')
      for (const scenario of [wrongAmount, wrongCurrency]) {
        assert.equal((await bookingsFor(scenario.reservationId)).length, 0)
        assert.equal((await reservationOf(scenario.reservationId)).status, 'pending')
      }
    })

    await t.test('a second payment for an already booked reservation is flagged, not booked', async () => {
      const { reservationId, attempt } = await openPayment()
      assert.equal((await deliver(paid(attempt))).response.status, 200)
      const duplicate = await prisma.payment_attempts.create({
        data: {
          reservation_id: reservationId, user_id: fixture.account.id, amount: '24.70', currency: 'PHP', status: 'expired',
          stripe_checkout_session_id: `cs_test_${randomUUID().replaceAll('-', '')}`, session_expires_at: new Date(Date.now() - MINUTE),
        },
      })
      assert.equal((await deliver(paid(duplicate))).response.status, 200)
      const flagged = await prisma.payment_attempts.findUnique({ where: { id: duplicate.id } })
      assert.equal(flagged.status, 'needs_review')
      assert.equal(flagged.review_reason, 'duplicate_payment')
      assert.equal((await bookingsFor(reservationId)).length, 1)
    })

    await t.test('events that arrive out of order or for other states are handled safely', async () => {
      // Expiry first, payment second: the payment is still honoured while the hold is valid.
      const outOfOrder = await openPayment()
      const expiredEvent = stripeEvent('checkout.session.expired', sessionFor(outOfOrder.attempt, { status: 'expired', payment_status: 'unpaid' }))
      assert.equal((await deliver(expiredEvent)).response.status, 200)
      assert.equal((await latestAttempt(outOfOrder.reservationId)).status, 'expired')
      assert.equal((await deliver(paid(outOfOrder.attempt))).response.status, 200)
      assert.equal((await latestAttempt(outOfOrder.reservationId)).status, 'fulfilled')
      assert.equal((await bookingsFor(outOfOrder.reservationId)).length, 1)

      // Payment first, expiry second: the expiry event cannot undo a recorded payment.
      const lateExpiry = await openPayment()
      await deliver(paid(lateExpiry.attempt))
      const ignored = stripeEvent('checkout.session.expired', sessionFor(lateExpiry.attempt, { status: 'expired', payment_status: 'unpaid' }))
      assert.equal((await deliver(ignored)).response.status, 200)
      assert.equal((await latestAttempt(lateExpiry.reservationId)).status, 'fulfilled')
      assert.equal((await webhookRow(ignored.id)).outcome, 'ignored')

      // A delayed payment that completes unpaid waits; its failure frees the reservation.
      const delayed = await openPayment()
      const unpaidEvent = stripeEvent('checkout.session.completed', sessionFor(delayed.attempt, { payment_status: 'unpaid' }))
      assert.equal((await deliver(unpaidEvent)).response.status, 200)
      assert.equal((await latestAttempt(delayed.reservationId)).status, 'open')
      assert.equal((await bookingsFor(delayed.reservationId)).length, 0)
      const failedEvent = stripeEvent('checkout.session.async_payment_failed', sessionFor(delayed.attempt, { payment_status: 'unpaid' }))
      assert.equal((await deliver(failedEvent)).response.status, 200)
      assert.equal((await latestAttempt(delayed.reservationId)).status, 'failed')
      assert.equal((await webhookRow(failedEvent.id)).outcome, 'processed')
      const retry = await startPayment(delayed.reservationId)
      assert.equal(retry.response.status, 201, 'A failed delayed payment frees the reservation for a new attempt.')
      const retryAttempt = await latestAttempt(delayed.reservationId)
      assert.notEqual(retryAttempt.id, delayed.attempt.id)

      // A failure event cannot undo a recorded payment.
      const settled = await openPayment()
      await deliver(paid(settled.attempt))
      const lateFailure = stripeEvent('checkout.session.async_payment_failed', sessionFor(settled.attempt))
      await deliver(lateFailure)
      assert.equal((await latestAttempt(settled.reservationId)).status, 'fulfilled')

      // A delayed payment that succeeds after its hold ended is recorded, never booked.
      const lateAsync = await openPayment()
      await expireHold(lateAsync.reservationId)
      await request('/api/reservations', { cookie: fixture.account.cookie })
      const asyncSuccess = stripeEvent('checkout.session.async_payment_succeeded', sessionFor(lateAsync.attempt))
      assert.equal((await deliver(asyncSuccess)).response.status, 200)
      assert.equal((await latestAttempt(lateAsync.reservationId)).review_reason, 'reservation_expired')
      assert.equal((await bookingsFor(lateAsync.reservationId)).length, 0)
    })

    await t.test('unknown and unmatched events are acknowledged and stored once', async () => {
      const unknown = stripeEvent('customer.created', { id: 'cus_test' })
      assert.equal((await deliver(unknown)).response.status, 200)
      assert.equal((await webhookRow(unknown.id)).outcome, 'ignored')

      const unmatched = stripeEvent('checkout.session.completed', {
        id: 'cs_test_unknown_session', client_reference_id: randomUUID(), payment_status: 'paid', amount_total: 100, currency: 'php',
      })
      assert.equal((await deliver(unmatched)).response.status, 200)
      assert.equal((await webhookRow(unmatched.id)).outcome, 'unmatched')
      assert.equal((await deliver(unmatched)).response.status, 200)
      assert.equal(await prisma.stripe_webhook_events.count({ where: { id: unmatched.id } }), 1)
    })

    await t.test('database constraints reject invalid payment states', async () => {
      const { reservationId, attempt } = await openPayment()
      // A real booking that belongs to a different reservation and is not linked to any attempt.
      const other = await reserve()
      const otherBooking = await prisma.bookings.create({
        data: { reservation_id: other.reservationId, user_id: fixture.account.id, total_amount: '24.70' },
      })

      async function rejects(sql, params, code) {
        await dbClient.query('BEGIN')
        try {
          await assert.rejects(dbClient.query(sql, params), (error) => error.code === code)
        } finally {
          await dbClient.query('ROLLBACK')
        }
      }

      // One live attempt per reservation.
      await rejects(
        `INSERT INTO payment_attempts (reservation_id, user_id, amount, session_expires_at) VALUES ($1, $2, 1.00, now())`,
        [reservationId, fixture.account.id], '23505',
      )
      // Fulfilled needs a booking; a recorded payment needs paid_at; needs_review needs a reason.
      await rejects(`UPDATE payment_attempts SET status = 'fulfilled', paid_at = now() WHERE id = $1`, [attempt.id], '23514')
      await rejects(`UPDATE payment_attempts SET status = 'needs_review', paid_at = now() WHERE id = $1`, [attempt.id], '23514')
      await rejects(`UPDATE payment_attempts SET status = 'expired', paid_at = now() WHERE id = $1`, [attempt.id], '23514')
      await rejects(`UPDATE payment_attempts SET status = 'bogus' WHERE id = $1`, [attempt.id], '23514')
      await rejects(`UPDATE payment_attempts SET status = 'open', checkout_url = NULL WHERE id = $1`, [attempt.id], '23514')
      await rejects(`UPDATE payment_attempts SET status = 'open', stripe_checkout_session_id = NULL WHERE id = $1`, [attempt.id], '23514')
      await rejects(`UPDATE payment_attempts SET currency = 'USD' WHERE id = $1`, [attempt.id], '23514')
      await rejects(`UPDATE payment_attempts SET amount = 0 WHERE id = $1`, [attempt.id], '23514')
      // A booking must belong to the attempt's own reservation (composite foreign key).
      await rejects(
        `UPDATE payment_attempts SET status = 'fulfilled', booking_id = $2, paid_at = now() WHERE id = $1`,
        [attempt.id, otherBooking.id], '23503',
      )
      await rejects(`UPDATE payment_attempts SET status = 'needs_review', review_reason = 'made_up', paid_at = now() WHERE id = $1`, [attempt.id], '23514')
      await rejects(`INSERT INTO stripe_webhook_events (id, type, outcome, stripe_created_at) VALUES ('evt_bad', 'x', 'nonsense', now())`, [], '23514')
      assert.equal((await prisma.payment_attempts.findUnique({ where: { id: attempt.id } })).status, 'open', 'Rejected statements changed nothing.')
    })
  } finally {
    paymentHooks.beforeRecordPayment = null
    setGatewayForTests(null)
    if (dbClient) await dbClient.end().catch(() => {})
    if (fixture.server) await new Promise((resolve) => fixture.server.close(resolve))
    if (databaseReady) {
      const discoveredUsers = fixture.emails.length
        ? await prisma.users.findMany({ where: { email: { in: fixture.emails } }, select: { id: true } })
        : []
      const userIds = [...new Set([...fixture.userIds, ...discoveredUsers.map((user) => user.id)])]
      const ownedReservations = userIds.length
        ? await prisma.reservations.findMany({ where: { user_id: { in: userIds } }, select: { id: true } })
        : []
      const reservationIds = [...new Set([...fixture.reservationIds, ...ownedReservations.map((reservation) => reservation.id)])]

      if (fixture.stripeEventIds.length) await prisma.stripe_webhook_events.deleteMany({ where: { id: { in: fixture.stripeEventIds } } })
      if (reservationIds.length) {
        // Payment attempts reference bookings, so they go first.
        await prisma.payment_attempts.deleteMany({ where: { reservation_id: { in: reservationIds } } })
        await prisma.bookings.deleteMany({ where: { reservation_id: { in: reservationIds } } })
        await prisma.reservation_items.deleteMany({ where: { reservation_id: { in: reservationIds } } })
      }
      if (userIds.length) {
        await prisma.idempotency_keys.deleteMany({ where: { user_id: { in: userIds } } })
        await prisma.bookings.deleteMany({ where: { user_id: { in: userIds } } })
      }
      if (reservationIds.length || userIds.length) {
        await prisma.reservations.deleteMany({
          where: {
            OR: [
              ...(reservationIds.length ? [{ id: { in: reservationIds } }] : []),
              ...(userIds.length ? [{ user_id: { in: userIds } }] : []),
            ],
          },
        })
      }
      if (fixture.ticketTypeIds.length) await prisma.ticket_types.deleteMany({ where: { id: { in: fixture.ticketTypeIds } } })
      if (fixture.eventIds.length) await prisma.events.deleteMany({ where: { id: { in: fixture.eventIds } } })
      if (userIds.length) await prisma.users.deleteMany({ where: { id: { in: userIds } } })
    }
    await disconnectPrisma()
  }
})
