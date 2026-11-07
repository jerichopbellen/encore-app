const test = require('node:test')
const assert = require('node:assert/strict')
const { randomBytes, randomUUID } = require('node:crypto')
const { Client } = require('../../server/node_modules/pg')
const { configureTestDatabase, assertConnectedToIntegrationDatabase } = require('../helpers/testDatabase.cjs')

// Configure Prisma before requiring the app: server/.env never selects the database here.
configureTestDatabase()
process.env.PAYMENT_PROVIDER = 'simulated'
process.env.NODE_ENV = 'test'
Object.assign(process.env, require('../helpers/rateLimitTestEnvironment.cjs').relaxedRateLimitEnvironment())
const app = require('../../server/src/app')
const { getPrismaClient, disconnectPrisma } = require('../../server/src/config/prisma')

const CONSTRAINT = 'reservation_items_quantity_range_check'

test('reservation_items.quantity is limited to 1..6 by PostgreSQL itself', { timeout: 30_000 }, async () => {
  const prisma = await getPrismaClient()
  const fixture = { emails: [], userIds: [], eventIds: [], ticketTypeIds: [], server: null }
  const dbClient = new Client({ connectionString: process.env.DATABASE_URL })
  let databaseReady = false

  try {
    // Confirm what the connection actually reached before any read or write.
    await assertConnectedToIntegrationDatabase(prisma)
    const counts = await Promise.all([
      prisma.users, prisma.events, prisma.ticket_types, prisma.reservations, prisma.reservation_items,
      prisma.bookings, prisma.idempotency_keys, prisma.payment_attempts, prisma.stripe_webhook_events,
    ].map((table) => table.count()))
    if (counts.some((count) => count > 0)) {
      throw new Error('The dedicated integration-test database must be empty before a run. Use a separate empty database; the suite does not clean pre-existing data.')
    }
    databaseReady = true
    await dbClient.connect()
    const { rows: [identity] } = await dbClient.query('SELECT current_database() AS database_name, current_schema() AS schema_name')
    assert.deepEqual([identity.database_name, identity.schema_name], ['encore_test', 'public'])

    // A clear failure if the migration has not been applied to this database.
    const { rows: definitions } = await dbClient.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conrelid = 'public.reservation_items'::regclass AND contype = 'c' ORDER BY conname`,
    )
    const range = definitions.find((row) => row.conname === CONSTRAINT)
    assert.ok(range, `${CONSTRAINT} is missing: apply migration 20261107000000_reservation_item_quantity_limit to the dedicated test database first.`)
    assert.match(range.definition, /quantity\s*>=\s*1.*quantity\s*<=\s*6/i)
    assert.equal(definitions.some((row) => row.conname === 'reservation_items_quantity_positive_check'), false,
      'the superseded "quantity > 0" check should have been replaced by the range check')

    // ---- Fixture -------------------------------------------------------------------------
    const TOTAL = 10
    const event = await prisma.events.create({
      data: {
        title: `Quantity limit ${randomUUID()}`, description: 'Automated test fixture', venue: 'Encore Test Hall',
        starts_at: new Date(Date.now() + 7 * 86400000), status: 'published',
      },
    })
    fixture.eventIds.push(event.id)
    const ticket = await prisma.ticket_types.create({
      data: { event_id: event.id, name: 'Quantity limit ticket', price: '10.00', total_quantity: TOTAL, available_quantity: TOTAL },
    })
    fixture.ticketTypeIds.push(ticket.id)

    fixture.server = app.listen(0, '127.0.0.1')
    await new Promise((resolve, reject) => {
      fixture.server.once('listening', resolve)
      fixture.server.once('error', reject)
    })
    const baseUrl = `http://127.0.0.1:${fixture.server.address().port}`
    async function request(path, { method = 'GET', body, cookie } = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      return { response, payload: await response.json().catch(() => null) }
    }

    const email = `encore-test-${randomUUID()}@example.test`
    fixture.emails.push(email)
    const password = randomBytes(24).toString('base64url')
    const registration = await request('/api/auth/register', { method: 'POST', body: { name: 'Quantity limit customer', email, password } })
    assert.equal(registration.response.status, 201)
    const userId = registration.payload.data.user.id
    fixture.userIds.push(userId)
    const login = await request('/api/auth/login', { method: 'POST', body: { email, password } })
    assert.equal(login.response.status, 200)
    const cookie = (login.response.headers.getSetCookie?.() ?? []).find((value) => /^encore_session=/i.test(value))?.split(';', 1)[0]
    assert.ok(cookie, 'login should set the session cookie')

    const reservationCount = () => prisma.reservations.count({ where: { user_id: userId } })
    const itemCount = () => prisma.reservation_items.count({ where: { ticket_type_id: ticket.id } })
    const availableQuantity = async () => (await prisma.ticket_types.findUnique({ where: { id: ticket.id } })).available_quantity
    const expiresAt = () => new Date(Date.now() + 15 * 60 * 1000)

    // ---- Accepted boundaries -------------------------------------------------------------
    for (const quantity of [1, 6]) {
      const created = await prisma.reservations.create({
        data: {
          user_id: userId, status: 'pending', expires_at: expiresAt(),
          reservation_items: { create: { ticket_type_id: ticket.id, quantity, unit_price: '10.00' } },
        },
        include: { reservation_items: true },
      })
      assert.equal(created.reservation_items[0].quantity, quantity)
    }
    assert.equal(await reservationCount(), 2)
    assert.equal(await itemCount(), 2)

    // ---- Rejected values: exact SQLSTATE and constraint, nothing left behind ----------------
    for (const quantity of [0, 7]) {
      await dbClient.query('BEGIN')
      try {
        const { rows: [reservation] } = await dbClient.query(
          `INSERT INTO reservations (user_id, status, expires_at) VALUES ($1::uuid, 'pending', now() + interval '15 minutes') RETURNING id`,
          [userId],
        )
        await assert.rejects(
          dbClient.query(
            `INSERT INTO reservation_items (reservation_id, ticket_type_id, quantity, unit_price) VALUES ($1::uuid, $2::uuid, $3, 10.00)`,
            [reservation.id, ticket.id, quantity],
          ),
          (error) => error.code === '23514' && error.constraint === CONSTRAINT,
          `quantity ${quantity} must violate ${CONSTRAINT}`,
        )
      } finally {
        await dbClient.query('ROLLBACK')
      }
    }
    // An UPDATE cannot push an accepted row over the limit either.
    await assert.rejects(
      dbClient.query(`UPDATE reservation_items SET quantity = 7 WHERE ticket_type_id = $1::uuid AND quantity = 6`, [ticket.id]),
      (error) => error.code === '23514' && error.constraint === CONSTRAINT,
    )

    // ---- Atomicity: a rejected write inside the reservation shape leaves no partial state --------
    // This mirrors createReservation (decrement inventory, then insert the reservation and its item).
    // Direct SQL must be refused by the CHECK, and the whole transaction must roll back.
    for (const quantity of [0, 7]) {
      await assert.rejects(
        prisma.$transaction(async (tx) => {
          await tx.ticket_types.update({ where: { id: ticket.id }, data: { available_quantity: { decrement: 3 } } })
          await tx.reservations.create({
            data: {
              user_id: userId, status: 'pending', expires_at: expiresAt(),
              reservation_items: { create: { ticket_type_id: ticket.id, quantity, unit_price: '10.00' } },
            },
          })
        }),
        (error) => /23514|reservation_items_quantity_range_check/.test(`${error.message} ${JSON.stringify(error.meta ?? {})} ${error.cause?.originalCode ?? ''}`),
      )
    }
    assert.equal(await reservationCount(), 2, 'rejected writes must not leave a reservation row')
    assert.equal(await itemCount(), 2, 'rejected writes must not leave an item row')
    assert.equal(await availableQuantity(), TOTAL, 'rejected writes must not change inventory')
    const quantities = (await prisma.reservation_items.findMany({ where: { ticket_type_id: ticket.id }, select: { quantity: true } }))
      .map((item) => item.quantity).sort()
    assert.deepEqual(quantities, [1, 6])

    // ---- The normal API still rejects above-limit quantities before the database is involved ------
    for (const quantity of [7, 8]) {
      const rejected = await request('/api/reservations', {
        method: 'POST', cookie, body: { event_id: event.id, ticket_type_id: ticket.id, quantity },
      })
      assert.equal(rejected.response.status, 400)
      assert.equal(rejected.payload.message, 'You can reserve at most 6 tickets at a time.')
    }
    assert.equal(await reservationCount(), 2)
    assert.equal(await availableQuantity(), TOTAL)
  } finally {
    await dbClient.query('ROLLBACK').catch(() => {})
    await dbClient.end().catch(() => {})
    if (fixture.server) await new Promise((resolve) => fixture.server.close(resolve))
    if (databaseReady) {
      // Delete only the records this test created.
      const discovered = fixture.emails.length
        ? await prisma.users.findMany({ where: { email: { in: fixture.emails } }, select: { id: true } })
        : []
      const userIds = [...new Set([...fixture.userIds, ...discovered.map((user) => user.id)])]
      if (userIds.length) {
        const owned = await prisma.reservations.findMany({ where: { user_id: { in: userIds } }, select: { id: true } })
        if (owned.length) await prisma.reservation_items.deleteMany({ where: { reservation_id: { in: owned.map((r) => r.id) } } })
        await prisma.reservations.deleteMany({ where: { user_id: { in: userIds } } })
      }
      if (fixture.ticketTypeIds.length) await prisma.ticket_types.deleteMany({ where: { id: { in: fixture.ticketTypeIds } } })
      if (fixture.eventIds.length) await prisma.events.deleteMany({ where: { id: { in: fixture.eventIds } } })
      if (userIds.length) await prisma.users.deleteMany({ where: { id: { in: userIds } } })
    }
    await disconnectPrisma()
  }
})
