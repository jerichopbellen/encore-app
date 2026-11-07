const test = require('node:test')
const assert = require('node:assert/strict')
const { randomBytes, randomUUID } = require('node:crypto')
const { Client } = require('../../server/node_modules/pg')
const { configureTestDatabase, assertConnectedToIntegrationDatabase } = require('../helpers/testDatabase.cjs')

// Configure Prisma before loading any service: server/.env never selects the database here.
configureTestDatabase()
const { getPrismaClient, disconnectPrisma } = require('../../server/src/config/prisma')
const { cancelReservation, createReservation } = require('../../server/src/services/reservationService')

// Which PostgreSQL error a rejected cancellation carried. Prisma wraps driver errors, so the
// SQLSTATE can appear on the error, on `meta`, or on the underlying driver error.
function describeError(error) {
  const codes = [error?.code, error?.meta?.code, error?.cause?.originalCode, error?.cause?.code, error?.cause?.cause?.originalCode]
    .filter((value) => typeof value === 'string')
  const text = String(error?.message ?? '')
  return {
    codes,
    isDeadlock: codes.includes('40P01') || /deadlock detected/i.test(text) || /deadlock/i.test(codes.join(' ')),
    summary: `${codes.join('/') || 'no-code'}: ${text.replace(/\s+/g, ' ').trim().slice(0, 300)} meta=${JSON.stringify(error?.meta ?? null).slice(0, 300)}`,
  }
}

// Polls PostgreSQL's own lock-wait state: returns the single backend that `blockerPid` is blocking.
async function waitForBackendBlockedBy(monitor, blockerPid, queryPattern) {
  const deadline = Date.now() + 10_000
  let lastSeen = 'nothing blocked'
  while (Date.now() < deadline) {
    await monitor.query('SELECT pg_stat_clear_snapshot()')
    const { rows } = await monitor.query(
      `SELECT activity.pid, activity.query
       FROM pg_stat_activity AS activity
       WHERE activity.datname = current_database()
         AND activity.backend_type = 'client backend'
         AND $1::int = ANY(pg_blocking_pids(activity.pid))`,
      [blockerPid],
    )
    const matching = rows.filter((row) => queryPattern.test(row.query))
    if (matching.length > 1) throw new Error(`Expected one backend blocked by ${blockerPid}; found ${matching.length}.`)
    if (matching.length === 1) return matching[0].pid
    if (rows.length > 0) lastSeen = `blocked but not at ${queryPattern}: ${rows.map((row) => row.query.slice(0, 80)).join(' | ')}`
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for a backend blocked by pid ${blockerPid} at ${queryPattern} (${lastSeen}).`)
}

test('concurrent cancellations acquire ticket locks in one global order (no deadlock)', { timeout: 45_000 }, async () => {
  const prisma = await getPrismaClient()
  const fixture = { userIds: [], eventIds: [], ticketTypeIds: [], reservationIds: [] }
  const holder = new Client({ connectionString: process.env.DATABASE_URL })
  const monitor = new Client({ connectionString: process.env.DATABASE_URL })
  let databaseReady = false
  let holderInTransaction = false

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

    await holder.connect()
    await monitor.connect()
    for (const client of [holder, monitor]) {
      const { rows: [identity] } = await client.query('SELECT current_database() AS database_name, current_schema() AS schema_name')
      assert.deepEqual([identity.database_name, identity.schema_name], ['encore_test', 'public'])
    }
    const { rows: [{ pid: holderPid }] } = await holder.query('SELECT pg_backend_pid() AS pid')

    // ---- Fixture -------------------------------------------------------------------------
    // Two ticket types whose IDs sort in a known order: LOW is locked before HIGH.
    const [lowId, highId] = [randomUUID(), randomUUID()].sort()
    const event = await prisma.events.create({
      data: {
        title: `Lock order ${randomUUID()}`, description: 'Automated test fixture', venue: 'Encore Test Hall',
        starts_at: new Date(Date.now() + 7 * 86400000), status: 'published',
      },
    })
    fixture.eventIds.push(event.id)

    // X (on LOW) becomes due at `becomesDueAt`; Y (on HIGH) is already due.
    // R_A (on LOW) and R_B (on HIGH) are the live holds the two customers cancel.
    const TOTAL = 10
    const holds = { X: 2, Y: 3, RA: 1, RB: 1 }
    const mkTicket = async (id, name, available) => {
      const ticket = await prisma.ticket_types.create({
        data: { id, event_id: event.id, name, price: '10.00', total_quantity: TOTAL, available_quantity: available },
      })
      fixture.ticketTypeIds.push(ticket.id)
    }
    await mkTicket(lowId, 'Low', TOTAL - holds.X - holds.RA)
    await mkTicket(highId, 'High', TOTAL - holds.Y - holds.RB)

    const mkUser = async (label) => {
      const user = await prisma.users.create({
        data: { name: `Lock order ${label}`, email: `encore-test-${randomUUID()}@example.test`, password_hash: randomBytes(16).toString('hex') },
      })
      fixture.userIds.push(user.id)
      return user.id
    }
    const [userX, userY, userA, userB] = [await mkUser('X'), await mkUser('Y'), await mkUser('A'), await mkUser('B')]

    const becomesDueAt = new Date(Date.now() + 1800)
    const mkReservation = async (userId, ticketTypeId, quantity, expiresAt) => {
      const reservation = await prisma.reservations.create({
        data: {
          user_id: userId, status: 'pending', expires_at: expiresAt,
          reservation_items: { create: { ticket_type_id: ticketTypeId, quantity, unit_price: '10.00' } },
        },
      })
      fixture.reservationIds.push(reservation.id)
      return reservation.id
    }
    const farFuture = new Date(Date.now() + 3600_000)
    const X = await mkReservation(userX, lowId, holds.X, becomesDueAt)
    const Y = await mkReservation(userY, highId, holds.Y, new Date(Date.now() - 60_000))
    const RA = await mkReservation(userA, lowId, holds.RA, farFuture)
    const RB = await mkReservation(userB, highId, holds.RB, farFuture)

    // ---- Arrangement ---------------------------------------------------------------------
    // 1. A separate connection locks reservation Y's row. Any sweep that tries to expire Y
    //    now stalls at that statement, after it has already locked its ticket types.
    await holder.query('BEGIN')
    holderInTransaction = true
    await holder.query('SELECT id FROM reservations WHERE id = $1::uuid FOR UPDATE', [Y])

    // 2. Customer A cancels RA. A's sweep runs before X is due, so it sees only Y and
    //    locks HIGH, then stalls on Y's row lock.
    const cancelA = cancelReservation(userA, RA)
    cancelA.catch(() => {}) // observed through allSettled below
    const pidA = await waitForBackendBlockedBy(monitor, holderPid, /UPDATE\s+"?public"?\."?reservations"?/i)
    assert.ok(Date.now() < becomesDueAt.getTime(),
      'Setup too slow: A must have read the due list before X became due. Re-run on an idle machine.')

    // 3. Wait (on the wall clock, not a guess about code paths) until X is due, then
    //    customer B cancels RB. B's sweep sees both X and Y, so it needs LOW then HIGH.
    while (Date.now() <= becomesDueAt.getTime() + 25) await new Promise((resolve) => setTimeout(resolve, 10))
    const cancelB = cancelReservation(userB, RB)
    cancelB.catch(() => {})
    // B is blocked by A on a ticket-type lock (with the original ordering it already holds LOW).
    await waitForBackendBlockedBy(monitor, pidA, /ticket_types/i)

    // 4. Release Y. A now continues towards its own ticket (LOW).
    await holder.query('COMMIT')
    holderInTransaction = false

    const [resultA, resultB] = await Promise.allSettled([cancelA, cancelB])

    // ---- Database consistency, checked whatever happened ---------------------------------
    const tickets = await prisma.ticket_types.findMany({ where: { id: { in: [lowId, highId] } } })
    for (const ticket of tickets) {
      assert.ok(ticket.available_quantity >= 0, 'inventory must never be negative')
      assert.ok(ticket.available_quantity <= ticket.total_quantity, 'inventory must never exceed capacity')
    }
    const reservations = await prisma.reservations.findMany({
      where: { id: { in: [X, Y, RA, RB] } }, include: { reservation_items: true },
    })
    const byId = new Map(reservations.map((reservation) => [reservation.id, reservation]))
    for (const [id, quantity, ticketTypeId] of [[X, holds.X, lowId], [Y, holds.Y, highId], [RA, holds.RA, lowId], [RB, holds.RB, highId]]) {
      const reservation = byId.get(id)
      assert.equal(reservation.reservation_items.length, 1, 'a reservation keeps exactly its one item')
      assert.equal(reservation.reservation_items[0].quantity, quantity)
      assert.equal(reservation.reservation_items[0].ticket_type_id, ticketTypeId)
    }
    // Ledger: available = total - quantity held by pending/confirmed reservations. A double
    // restoration (or a lost one) would break this equality for the affected ticket.
    for (const ticket of tickets) {
      const held = reservations
        .filter((reservation) => ['pending', 'confirmed'].includes(reservation.status))
        .flatMap((reservation) => reservation.reservation_items)
        .filter((item) => item.ticket_type_id === ticket.id)
        .reduce((sum, item) => sum + item.quantity, 0)
      assert.equal(ticket.available_quantity, ticket.total_quantity - held,
        `ticket ${ticket.id === lowId ? 'LOW' : 'HIGH'} inventory must equal capacity minus live holds`)
    }
    // A reservation moves out of pending only once, and only to its legal destination.
    assert.ok(['pending', 'expired'].includes(byId.get(X).status))
    assert.ok(['pending', 'expired'].includes(byId.get(Y).status))
    assert.ok(['pending', 'cancelled'].includes(byId.get(RA).status))
    assert.ok(['pending', 'cancelled'].includes(byId.get(RB).status))

    // ---- The behaviour under test --------------------------------------------------------
    const rejections = [['A', resultA], ['B', resultB]]
      .filter(([, result]) => result.status === 'rejected')
      .map(([name, result]) => ({ name, ...describeError(result.reason) }))
    const deadlocks = rejections.filter((rejection) => rejection.isDeadlock)
    assert.deepEqual(deadlocks.map((d) => `${d.name} ${d.summary}`), [],
      'PostgreSQL aborted a cancellation with a deadlock (40P01): lock acquisition is not globally ordered')
    assert.deepEqual(rejections.map((r) => `${r.name} ${r.summary}`), [], 'no cancellation may fail for another reason')

    assert.equal(resultA.value.outcome, 'cancelled')
    assert.equal(resultB.value.outcome, 'cancelled')
    assert.deepEqual(
      ['X', 'Y', 'RA', 'RB'].map((name) => byId.get({ X, Y, RA, RB }[name]).status),
      ['expired', 'expired', 'cancelled', 'cancelled'],
    )
    // Every hold was released exactly once.
    for (const ticket of tickets) assert.equal(ticket.available_quantity, TOTAL)
  } finally {
    if (holderInTransaction) await holder.query('ROLLBACK').catch(() => {})
    await holder.end().catch(() => {})
    await monitor.end().catch(() => {})
    if (databaseReady) {
      // Delete only the records this test created.
      const { userIds, reservationIds, ticketTypeIds, eventIds } = fixture
      if (reservationIds.length) await prisma.reservation_items.deleteMany({ where: { reservation_id: { in: reservationIds } } })
      if (userIds.length) await prisma.reservations.deleteMany({ where: { user_id: { in: userIds } } })
      if (ticketTypeIds.length) await prisma.ticket_types.deleteMany({ where: { id: { in: ticketTypeIds } } })
      if (eventIds.length) await prisma.events.deleteMany({ where: { id: { in: eventIds } } })
      if (userIds.length) await prisma.users.deleteMany({ where: { id: { in: userIds } } })
    }
    await disconnectPrisma()
  }
})

test('createReservation takes the per-user FOR NO KEY UPDATE lock before counting holds or touching inventory', { timeout: 30_000 }, async () => {
  const prisma = await getPrismaClient()
  const fixture = { userIds: [], eventIds: [], ticketTypeIds: [] }
  const holder = new Client({ connectionString: process.env.DATABASE_URL })
  const monitor = new Client({ connectionString: process.env.DATABASE_URL })
  let databaseReady = false
  let holderInTransaction = false

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

    await holder.connect()
    await monitor.connect()
    for (const client of [holder, monitor]) {
      const { rows: [identity] } = await client.query('SELECT current_database() AS database_name, current_schema() AS schema_name')
      assert.deepEqual([identity.database_name, identity.schema_name], ['encore_test', 'public'])
    }
    const { rows: [{ pid: holderPid }] } = await holder.query('SELECT pg_backend_pid() AS pid')

    // ---- Fixture -------------------------------------------------------------------------
    const TOTAL = 8
    const QUANTITY = 2
    const event = await prisma.events.create({
      data: {
        title: `User lock ${randomUUID()}`, description: 'Automated test fixture', venue: 'Encore Test Hall',
        starts_at: new Date(Date.now() + 7 * 86400000), status: 'published',
      },
    })
    fixture.eventIds.push(event.id)
    const ticket = await prisma.ticket_types.create({
      data: { event_id: event.id, name: 'User lock ticket', price: '10.00', total_quantity: TOTAL, available_quantity: TOTAL },
    })
    fixture.ticketTypeIds.push(ticket.id)
    const user = await prisma.users.create({
      data: { name: 'User lock customer', email: `encore-test-${randomUUID()}@example.test`, password_hash: randomBytes(16).toString('hex') },
    })
    fixture.userIds.push(user.id)

    const reservationCount = () => prisma.reservations.count({ where: { user_id: user.id } })
    const availableQuantity = async () => (await prisma.ticket_types.findUnique({ where: { id: ticket.id } })).available_quantity

    // ---- Hold the user's row lock from a separate connection ------------------------------
    await holder.query('BEGIN')
    holderInTransaction = true
    await holder.query('SELECT id FROM users WHERE id = $1::uuid FOR NO KEY UPDATE', [user.id])

    // ---- Start the real application path --------------------------------------------------
    const creation = createReservation(user.id, { event_id: event.id, ticket_type_id: ticket.id, quantity: QUANTITY })
    let settledEarly = false
    const creationOutcome = creation.then(
      () => { settledEarly = true },
      () => { settledEarly = true },
    )

    // PostgreSQL must report a backend blocked by our lock holder, running the marked
    // user-lock statement. If creation finishes (or fails) without waiting, fail at once.
    const blockedWait = waitForBackendBlockedBy(monitor, holderPid, /encore-reservation-user-lock[\s\S]*FOR NO KEY UPDATE/i)
    blockedWait.catch(() => {}) // a rejection after an early failure must not become unhandled
    const blockedPid = await Promise.race([
      blockedWait,
      creationOutcome.then(() => {
        throw new Error('createReservation settled without waiting for the held user-row lock.')
      }),
    ])
    assert.equal(settledEarly, false)

    // The wait is a genuine row-lock wait, not an unrelated delay.
    await monitor.query('SELECT pg_stat_clear_snapshot()')
    const { rows: [waiting] } = await monitor.query(
      `SELECT wait_event_type, state, $2::int = ANY(pg_blocking_pids(pid)) AS blocked_by_holder
       FROM pg_stat_activity WHERE pid = $1`,
      [blockedPid, holderPid],
    )
    assert.equal(waiting.wait_event_type, 'Lock')
    assert.equal(waiting.blocked_by_holder, true)

    // Nothing past the lock has happened: no reservation row, no inventory decrement.
    assert.equal(await reservationCount(), 0, 'no reservation may exist while the user lock is held elsewhere')
    assert.equal(await availableQuantity(), TOTAL, 'inventory must not change while the user lock is held elsewhere')
    assert.equal(settledEarly, false)

    // ---- Release the lock and let the creation finish -------------------------------------
    await holder.query('COMMIT')
    holderInTransaction = false
    const created = await creation

    assert.equal(created.status, 'pending')
    assert.equal(created.items.length, 1)
    assert.equal(created.items[0].quantity, QUANTITY)
    assert.equal(await reservationCount(), 1)
    const stored = await prisma.reservations.findMany({ where: { user_id: user.id }, include: { reservation_items: true } })
    assert.equal(stored.length, 1)
    assert.equal(stored[0].id, created.id)
    assert.equal(stored[0].status, 'pending')
    assert.deepEqual(stored[0].reservation_items.map((item) => [item.ticket_type_id, item.quantity]), [[ticket.id, QUANTITY]])
    assert.equal(await availableQuantity(), TOTAL - QUANTITY)
  } finally {
    if (holderInTransaction) await holder.query('ROLLBACK').catch(() => {})
    await holder.end().catch(() => {})
    await monitor.end().catch(() => {})
    if (databaseReady) {
      // Delete only the records this test created.
      const { userIds, ticketTypeIds, eventIds } = fixture
      if (userIds.length) {
        const owned = await prisma.reservations.findMany({ where: { user_id: { in: userIds } }, select: { id: true } })
        if (owned.length) await prisma.reservation_items.deleteMany({ where: { reservation_id: { in: owned.map((r) => r.id) } } })
        await prisma.reservations.deleteMany({ where: { user_id: { in: userIds } } })
      }
      if (ticketTypeIds.length) await prisma.ticket_types.deleteMany({ where: { id: { in: ticketTypeIds } } })
      if (eventIds.length) await prisma.events.deleteMany({ where: { id: { in: eventIds } } })
      if (userIds.length) await prisma.users.deleteMany({ where: { id: { in: userIds } } })
    }
    await disconnectPrisma()
  }
})
