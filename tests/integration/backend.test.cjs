const test = require('node:test')
const assert = require('node:assert/strict')
const { randomBytes, randomUUID } = require('node:crypto')
const { configureTestDatabase } = require('../helpers/testDatabase.cjs')

// Configure Prisma before requiring the app: the ordinary server/.env is never
// allowed to select a database for this suite.
configureTestDatabase()
const app = require('../../server/src/app')
const { getPrismaClient, disconnectPrisma } = require('../../server/src/config/prisma')

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
  assert.equal(/;\s*httponly/i.test(sessionCookie), true, 'Session cookie should be HttpOnly.')
  assert.equal(/;\s*samesite=lax/i.test(sessionCookie), true, 'Session cookie should use SameSite=Lax.')
  return sessionCookie.split(';', 1)[0]
}

test('Encore backend behavior against the dedicated PostgreSQL test database', async (t) => {
  const prisma = await getPrismaClient()
  const fixture = {
    emails: [],
    userIds: [],
    eventIds: [],
    ticketTypeIds: [],
    reservationIds: [],
    account: null,
    otherAccount: null,
    server: null,
  }
  let databaseReady = false

  async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
    const response = await fetch(`${fixture.baseUrl}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { response, payload: await response.json().catch(() => null) }
  }

  async function createAccount(name) {
    const email = `encore-test-${randomUUID()}@example.test`
    fixture.emails.push(email)
    const password = randomBytes(24).toString('base64url')
    const registration = await request('/api/auth/register', {
      method: 'POST',
      body: { name, email, password },
    })
    assert.equal(registration.response.status, 201)
    assert.equal(registration.payload.data.user.email, email)
    assert.equal(Object.hasOwn(registration.payload.data.user, 'password_hash'), false)
    fixture.userIds.push(registration.payload.data.user.id)

    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    assert.equal(login.response.status, 200)
    return { id: registration.payload.data.user.id, email, password, cookie: cookieFromLogin(login.response) }
  }

  async function createEvent(title, status = 'published') {
    const event = await prisma.events.create({
      data: {
        title: `${title} ${randomUUID()}`,
        description: 'Automated test fixture',
        venue: 'Encore Test Hall',
        starts_at: new Date(Date.now() + 86400000),
        status,
      },
    })
    fixture.eventIds.push(event.id)
    return event
  }

  async function createTicketType(eventId, availableQuantity = 8) {
    const ticketType = await prisma.ticket_types.create({
      data: {
        event_id: eventId,
        name: `Test ticket ${randomUUID()}`,
        price: '12.35',
        total_quantity: 8,
        available_quantity: availableQuantity,
      },
    })
    fixture.ticketTypeIds.push(ticketType.id)
    return ticketType
  }

  async function createReservation(account, eventId, ticketTypeId, quantity = 1, extra = {}) {
    const result = await request('/api/reservations', {
      method: 'POST',
      cookie: account.cookie,
      body: { event_id: eventId, ticket_type_id: ticketTypeId, quantity, ...extra },
    })
    if (result.response.status === 201) fixture.reservationIds.push(result.payload.data.reservation.id)
    return result
  }

  try {
    // This read-only preflight fails clearly if the dedicated database is not prepared.
    let existingRowCounts
    try {
      await prisma.$queryRaw`SELECT 1`
      existingRowCounts = await Promise.all([
        prisma.users,
        prisma.events,
        prisma.ticket_types,
        prisma.reservations,
        prisma.reservation_items,
        prisma.bookings,
        prisma.idempotency_keys,
      ].map((table) => table.count()))
    } catch {
      throw new Error('The dedicated test database is unavailable or does not have Encore tables. Prepare only the database named in TEST_DATABASE_URL before running integration tests.')
    }
    if (existingRowCounts.some((count) => count > 0)) {
      throw new Error('The dedicated integration-test database must be empty before a run. Use a separate empty database; the suite does not clean pre-existing data.')
    }
    databaseReady = true

    fixture.server = app.listen(0, '127.0.0.1')
    await new Promise((resolve, reject) => {
      fixture.server.once('listening', resolve)
      fixture.server.once('error', reject)
    })
    fixture.baseUrl = `http://127.0.0.1:${fixture.server.address().port}`

    await t.test('health, not-found, and safe error responses', async () => {
      const health = await request('/api/health')
      assert.equal(health.response.status, 200)
      assert.deepEqual(health.payload, { success: true, message: 'Encore API is running!' })

      const missing = await request('/api/not-a-route')
      assert.equal(missing.response.status, 404)
      assert.equal(missing.payload.success, false)
      assert.match(missing.payload.message, /Route not found/)

      const invalidEvent = await request('/api/events/not-a-uuid')
      assert.equal(invalidEvent.response.status, 400)
      assert.equal(invalidEvent.payload.message, 'Event ID must be a valid UUID.')

      const protectedBookings = await request('/api/bookings')
      assert.equal(protectedBookings.response.status, 401)
    })

    await t.test('registration, login, session, profile, logout, and access control', async () => {
      const missingSession = await request('/api/auth/me')
      assert.equal(missingSession.response.status, 401)

      fixture.account = await createAccount('Test Customer')
      fixture.otherAccount = await createAccount('Second Customer')

      const duplicate = await request('/api/auth/register', {
        method: 'POST',
        body: { name: 'Duplicate', email: fixture.account.email, password: fixture.account.password },
      })
      assert.equal(duplicate.response.status, 409)

      const invalidRegistration = await request('/api/auth/register', {
        method: 'POST',
        body: { name: ' ', email: 'invalid', password: 'short' },
      })
      assert.equal(invalidRegistration.response.status, 400)

      const invalidLogin = await request('/api/auth/login', {
        method: 'POST',
        body: { email: fixture.account.email, password: randomBytes(20).toString('base64url') },
      })
      assert.equal(invalidLogin.response.status, 401)
      assert.equal(invalidLogin.payload.message, 'Invalid email or password.')

      const session = await request('/api/auth/me', { cookie: fixture.account.cookie })
      assert.equal(session.response.status, 200)
      assert.equal(session.payload.data.user.id, fixture.account.id)
      assert.equal(Object.hasOwn(session.payload.data.user, 'password_hash'), false)

      const updated = await request('/api/auth/me', {
        method: 'PATCH',
        cookie: fixture.account.cookie,
        body: { name: '  Updated Test Customer  ' },
      })
      assert.equal(updated.response.status, 200)
      assert.equal(updated.payload.data.user.name, 'Updated Test Customer')
      assert.equal(updated.payload.data.user.id, fixture.account.id)

      const invalidProfile = await request('/api/auth/me', {
        method: 'PATCH', cookie: fixture.account.cookie, body: { name: ' ' },
      })
      assert.equal(invalidProfile.response.status, 400)

      const otherSession = await request('/api/auth/me', { cookie: fixture.otherAccount.cookie })
      assert.equal(otherSession.payload.data.user.name, 'Second Customer')

      const logout = await request('/api/auth/logout', { method: 'POST', cookie: fixture.account.cookie })
      assert.equal(logout.response.status, 200)
      const clearedCookie = logout.response.headers.getSetCookie?.() || [logout.response.headers.get('set-cookie') || '']
      assert.ok(clearedCookie.some((value) => /^encore_session=;/i.test(value)), 'Logout should clear the session cookie.')
      const afterLogout = await request('/api/auth/me')
      assert.equal(afterLogout.response.status, 401)

      // Log the test account back in for the reservation scenarios below.
      const relogin = await request('/api/auth/login', {
        method: 'POST',
        body: { email: fixture.account.email, password: fixture.account.password },
      })
      fixture.account.cookie = cookieFromLogin(relogin.response)
    })

    const event = await createEvent('Published Integration Event')
    const unpublishedEvent = await createEvent('Unpublished Integration Event', 'draft')
    const ticket = await createTicketType(event.id)
    const secondEvent = await createEvent('Other Published Integration Event')
    const secondEventTicket = await createTicketType(secondEvent.id)

    await t.test('public events expose published fixtures and their ticket data', async () => {
      const list = await request('/api/events')
      assert.equal(list.response.status, 200)
      const published = list.payload.data.find((item) => item.id === event.id)
      assert.ok(published)
      assert.equal(list.payload.data.some((item) => item.id === unpublishedEvent.id), false)
      assert.equal(published.ticket_types[0].id, ticket.id)
      assert.equal(published.ticket_types[0].price, '12.35')
      assert.equal(published.ticket_types[0].available_quantity, 8)

      const detail = await request(`/api/events/${event.id}`)
      assert.equal(detail.response.status, 200)
      assert.equal(detail.payload.data.id, event.id)
      const missing = await request('/api/events/ffffffff-ffff-4fff-8fff-ffffffffffff')
      assert.equal(missing.response.status, 404)
      const unpublished = await request(`/api/events/${unpublishedEvent.id}`)
      assert.equal(unpublished.response.status, 404)
    })

    await t.test('reservation validation, trusted prices, ownership, and cancellation', async () => {
      const unauthenticated = await request('/api/reservations', {
        method: 'POST', body: { event_id: event.id, ticket_type_id: ticket.id, quantity: 1 },
      })
      assert.equal(unauthenticated.response.status, 401)

      const created = await createReservation(fixture.account, event.id, ticket.id, 2, {
        unit_price: '0.01', total_amount: '0.02',
      })
      assert.equal(created.response.status, 201)
      const reservation = created.payload.data.reservation
      assert.equal(reservation.status, 'pending')
      assert.equal(reservation.items[0].unit_price, '12.35')
      assert.equal(reservation.items[0].line_total, '24.70')
      assert.equal(reservation.total_amount, '24.70')
      const holdMinutes = (new Date(reservation.expires_at) - new Date(reservation.created_at)) / 60000
      assert.ok(holdMinutes >= 14 && holdMinutes <= 16, 'Reservation should have approximately a 15-minute hold.')
      assert.equal((await prisma.ticket_types.findUnique({ where: { id: ticket.id } })).available_quantity, 6)

      const invalidQuantity = await createReservation(fixture.account, event.id, ticket.id, 0)
      assert.equal(invalidQuantity.response.status, 400)
      const mismatchedTicket = await createReservation(fixture.account, secondEvent.id, ticket.id, 1)
      assert.equal(mismatchedTicket.response.status, 400)
      const reservationCountBeforeInsufficient = await prisma.reservations.count({ where: { user_id: fixture.account.id } })
      const insufficient = await createReservation(fixture.account, event.id, ticket.id, 100)
      assert.equal(insufficient.response.status, 409)
      assert.equal((await prisma.ticket_types.findUnique({ where: { id: ticket.id } })).available_quantity, 6)
      assert.equal(await prisma.reservations.count({ where: { user_id: fixture.account.id } }), reservationCountBeforeInsufficient)

      const otherOwner = await request(`/api/reservations/${reservation.id}`, { cookie: fixture.otherAccount.cookie })
      assert.equal(otherOwner.response.status, 404)
      const otherCheckout = await request(`/api/reservations/${reservation.id}/checkout`, {
        method: 'POST', cookie: fixture.otherAccount.cookie,
      })
      assert.equal(otherCheckout.response.status, 404)

      const cancelled = await request(`/api/reservations/${reservation.id}/cancel`, {
        method: 'POST', cookie: fixture.account.cookie,
      })
      assert.equal(cancelled.response.status, 200)
      assert.equal(cancelled.payload.data.reservation.status, 'cancelled')
      assert.equal((await prisma.ticket_types.findUnique({ where: { id: ticket.id } })).available_quantity, 8)

      const repeatedCancel = await request(`/api/reservations/${reservation.id}/cancel`, {
        method: 'POST', cookie: fixture.account.cookie,
      })
      assert.equal(repeatedCancel.response.status, 409)
      assert.equal((await prisma.ticket_types.findUnique({ where: { id: ticket.id } })).available_quantity, 8)

      const cancelledCheckout = await request(`/api/reservations/${reservation.id}/checkout`, {
        method: 'POST', cookie: fixture.account.cookie,
      })
      assert.equal(cancelledCheckout.response.status, 409)
    })

    await t.test('expiration races restore inventory once and expired holds cannot check out', async () => {
      const created = await createReservation(fixture.account, event.id, ticket.id, 1)
      assert.equal(created.response.status, 201)
      const reservationId = created.payload.data.reservation.id
      await prisma.reservations.update({ where: { id: reservationId }, data: { expires_at: new Date(Date.now() - 1000) } })
      const availableBefore = (await prisma.ticket_types.findUnique({ where: { id: ticket.id } })).available_quantity
      const startTogether = makeBarrier(2)
      const [cancelResult, listResult] = await Promise.all([
        startTogether(() => request(`/api/reservations/${reservationId}/cancel`, { method: 'POST', cookie: fixture.account.cookie })),
        startTogether(() => request('/api/reservations', { cookie: fixture.account.cookie })),
      ])
      assert.ok([200, 409].includes(cancelResult.response.status))
      assert.equal(listResult.response.status, 200)
      assert.equal((await prisma.reservations.findUnique({ where: { id: reservationId } })).status, 'expired')
      assert.equal((await prisma.ticket_types.findUnique({ where: { id: ticket.id } })).available_quantity, availableBefore + 1)

      const checkout = await request(`/api/reservations/${reservationId}/checkout`, {
        method: 'POST', cookie: fixture.account.cookie,
      })
      assert.equal(checkout.response.status, 409)
      assert.equal((await prisma.ticket_types.findUnique({ where: { id: ticket.id } })).available_quantity, availableBefore + 1)
    })

    await t.test('concurrent reservation requests cannot claim the final ticket', async () => {
      await prisma.ticket_types.update({ where: { id: ticket.id }, data: { available_quantity: 1 } })
      const startTogether = makeBarrier(2)
      const outcomes = await Promise.all([
        startTogether(() => createReservation(fixture.account, event.id, ticket.id, 1)),
        startTogether(() => createReservation(fixture.otherAccount, event.id, ticket.id, 1)),
      ])
      const statusCodes = outcomes.map((result) => result.response.status).sort((a, b) => a - b)
      assert.deepEqual(statusCodes, [201, 409])
      assert.equal((await prisma.ticket_types.findUnique({ where: { id: ticket.id } })).available_quantity, 0)
      const successfulReservationIds = outcomes
        .filter((result) => result.response.status === 201)
        .map((result) => result.payload.data.reservation.id)
      assert.equal(successfulReservationIds.length, 1)
      assert.equal(await prisma.reservations.count({ where: { id: { in: successfulReservationIds } } }), 1)
    })

    await t.test('checkout creates one owner-scoped booking using saved amounts and rolls back on failure', async () => {
      await prisma.ticket_types.update({ where: { id: ticket.id }, data: { available_quantity: 2 } })
      const created = await createReservation(fixture.account, event.id, ticket.id, 2, { total_amount: '0.01' })
      assert.equal(created.response.status, 201)
      const reservationId = created.payload.data.reservation.id
      const inventoryAfterHold = (await prisma.ticket_types.findUnique({ where: { id: ticket.id } })).available_quantity

      const checkout = await request(`/api/reservations/${reservationId}/checkout`, {
        method: 'POST', cookie: fixture.account.cookie,
        body: { total_amount: '0.01', unit_price: '0.01' },
      })
      assert.equal(checkout.response.status, 201)
      const booking = checkout.payload.data.booking
      fixture.reservationIds.push(reservationId)
      assert.equal(booking.total_amount, '24.70')
      assert.equal((await prisma.reservations.findUnique({ where: { id: reservationId } })).status, 'confirmed')
      assert.equal((await prisma.ticket_types.findUnique({ where: { id: ticket.id } })).available_quantity, inventoryAfterHold)

      const repeated = await request(`/api/reservations/${reservationId}/checkout`, {
        method: 'POST', cookie: fixture.account.cookie,
      })
      assert.equal(repeated.response.status, 409)
      assert.equal(await prisma.bookings.count({ where: { reservation_id: reservationId } }), 1)
      await assert.rejects(
        prisma.bookings.create({ data: { reservation_id: reservationId, user_id: fixture.account.id, total_amount: '24.70' } }),
        (error) => error.code === 'P2002',
      )

      const list = await request('/api/bookings', { cookie: fixture.account.cookie })
      assert.equal(list.response.status, 200)
      assert.ok(list.payload.data.some((item) => item.id === booking.id))
      const detail = await request(`/api/bookings/${booking.id}`, { cookie: fixture.account.cookie })
      assert.equal(detail.response.status, 200)
      assert.equal(detail.payload.data.booking.total_amount, '24.70')
      const otherDetail = await request(`/api/bookings/${booking.id}`, { cookie: fixture.otherAccount.cookie })
      assert.equal(otherDetail.response.status, 404)

      await prisma.ticket_types.update({ where: { id: ticket.id }, data: { available_quantity: 1 } })
      const concurrentReservation = await createReservation(fixture.account, event.id, ticket.id, 1)
      assert.equal(concurrentReservation.response.status, 201)
      const concurrentReservationId = concurrentReservation.payload.data.reservation.id
      const startTogether = makeBarrier(2)
      const concurrentCheckouts = await Promise.all([
        startTogether(() => request(`/api/reservations/${concurrentReservationId}/checkout`, { method: 'POST', cookie: fixture.account.cookie })),
        startTogether(() => request(`/api/reservations/${concurrentReservationId}/checkout`, { method: 'POST', cookie: fixture.account.cookie })),
      ])
      assert.deepEqual(concurrentCheckouts.map((item) => item.response.status).sort((a, b) => a - b), [201, 409])
      fixture.reservationIds.push(concurrentReservationId)
      assert.equal(await prisma.bookings.count({ where: { reservation_id: concurrentReservationId } }), 1)
      assert.equal((await prisma.ticket_types.findUnique({ where: { id: ticket.id } })).available_quantity, 0)

      await prisma.ticket_types.update({ where: { id: ticket.id }, data: { available_quantity: 1 } })
      const failedReservation = await createReservation(fixture.account, event.id, ticket.id, 1)
      assert.equal(failedReservation.response.status, 201)
      const failedReservationId = failedReservation.payload.data.reservation.id
      fixture.reservationIds.push(failedReservationId)
      await prisma.bookings.create({
        data: { reservation_id: failedReservationId, user_id: fixture.account.id, total_amount: '12.35' },
      })
      const failedCheckout = await request(`/api/reservations/${failedReservationId}/checkout`, {
        method: 'POST', cookie: fixture.account.cookie,
      })
      assert.equal(failedCheckout.response.status, 500)
      assert.equal(failedCheckout.payload.message, 'An unexpected server error occurred.')
      assert.equal((await prisma.reservations.findUnique({ where: { id: failedReservationId } })).status, 'pending')
    })
  } finally {
    if (fixture.server) await new Promise((resolve) => fixture.server.close(resolve))
    if (databaseReady) {
      const discoveredUsers = fixture.emails.length
        ? await prisma.users.findMany({ where: { email: { in: fixture.emails } }, select: { id: true } })
        : []
      const userIds = [...new Set([...fixture.userIds, ...discoveredUsers.map((user) => user.id)])]
      const ownedReservations = userIds.length
        ? await prisma.reservations.findMany({ where: { user_id: { in: userIds } }, select: { id: true } })
        : []
      const reservationIds = [...new Set([
        ...fixture.reservationIds,
        ...ownedReservations.map((reservation) => reservation.id),
      ])]

      if (userIds.length || reservationIds.length) {
        await prisma.bookings.deleteMany({
          where: {
            OR: [
              ...(userIds.length ? [{ user_id: { in: userIds } }] : []),
              ...(reservationIds.length ? [{ reservation_id: { in: reservationIds } }] : []),
            ],
          },
        })
      }
      if (reservationIds.length) {
        await prisma.reservation_items.deleteMany({ where: { reservation_id: { in: reservationIds } } })
      }
      if (userIds.length) await prisma.idempotency_keys.deleteMany({ where: { user_id: { in: userIds } } })
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
