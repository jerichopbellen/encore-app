const fs = require('node:fs')
const path = require('node:path')
const { Client } = require('pg')
const bcrypt = require('bcrypt')
const { validateTestDatabaseUrl } = require('../../tests/helpers/testDatabase.cjs')
const {
  E2eSafetyError,
  APP_TABLES,
  EXPECTED_TABLES,
  assertConnectedToE2eDatabase,
  customerEmailPrefix,
  eventTitlePrefix,
  isCustomerOfRun,
  validateE2eDatabaseTarget,
} = require('../../client/e2e/support/databaseSafety.cjs')

const EVENT_ID = 'a2000000-0000-4000-8000-000000000001'
const PAST_EVENT_ID = 'a2000000-0000-4000-8000-000000000002'

function repositoryMigrationNames() {
  const directory = path.join(__dirname, '..', 'prisma', 'migrations')
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function ensureDatabaseEnvironment() {
  // Reuse the same explicit test-URL validation used by PostgreSQL integration tests.
  try {
    validateTestDatabaseUrl(process.env.TEST_DATABASE_URL)
  } catch {
    throw new E2eSafetyError('TEST_DATABASE_URL is required and must be a PostgreSQL URL with a distinct test database name.')
  }
  validateE2eDatabaseTarget()
}

async function preflight() {
  ensureDatabaseEnvironment()
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL })

  try {
    await client.connect()
    const identity = await client.query('SELECT current_database() AS database_name, current_schema() AS schema_name')
    assertConnectedToE2eDatabase(identity.rows[0])

    const tables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    )
    // A brand-new database is accepted so migrations can be applied to it. Otherwise
    // the schema must be exactly the fully migrated Encore schema; any other state
    // (unknown tables, missing tables, partial or failed migrations) is rejected.
    if (tables.rowCount > 0) {
      const present = tables.rows.map(({ table_name: name }) => name).sort()
      const expected = [...EXPECTED_TABLES].sort()
      if (present.join(',') !== expected.join(',')) {
        throw new E2eSafetyError('The E2E database schema is neither empty nor the expected migrated Encore schema. No data was changed.')
      }
      const history = await client.query(
        'SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM public._prisma_migrations ORDER BY migration_name',
      )
      const applied = history.rows.map((row) => row.migration_name)
      if (applied.join(',') !== repositoryMigrationNames().join(',')
        || history.rows.some((row) => !row.finished || row.rolled_back)) {
        throw new E2eSafetyError('The E2E database migration history does not match the repository migrations. No data was changed.')
      }
    }
  } finally {
    await client.end().catch(() => {})
  }
}

async function getPrisma() {
  ensureDatabaseEnvironment()
  // The test URL is explicitly required and validated before runtime config loads.
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  const { getPrismaClient } = require('../src/config/prisma')
  const prisma = await getPrismaClient()
  // Fixtures and cleanup write and delete, so confirm what the connection actually
  // reached (not only what the URL says) before any caller touches a table.
  try {
    const [identity] = await prisma.$queryRaw`SELECT current_database() AS database_name, current_schema() AS schema_name`
    assertConnectedToE2eDatabase(identity)
  } catch (error) {
    await prisma.$disconnect().catch(() => {})
    throw error
  }
  return prisma
}

async function createFixtures() {
  const prisma = await getPrisma()
  try {
    const counts = await Promise.all(APP_TABLES.map((name) => prisma[name].count()))
    if (counts.some((count) => count !== 0)) {
      throw new E2eSafetyError('Encore tables in the E2E database must be empty before fixtures are created.')
    }

    const runId = process.env.E2E_RUN_ID
    const adminEmail = process.env.E2E_ADMIN_EMAIL
    const adminPassword = process.env.E2E_ADMIN_PASSWORD
    if (!adminEmail || !adminPassword) throw new E2eSafetyError('E2E administrator fixture settings are required.')

    await prisma.users.create({
      data: {
        name: 'Encore E2E Administrator',
        email: adminEmail,
        password_hash: await bcrypt.hash(adminPassword, 12),
        role: 'admin',
      },
    })

    await prisma.events.create({
      data: {
        id: EVENT_ID,
        title: `Encore E2E ${runId} Reservation Night`,
        description: 'An isolated browser test event.',
        venue: 'Encore E2E Test Hall',
        starts_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: 'published',
        ticket_types: {
          create: {
            name: 'General Admission',
            price: '25.00',
            total_quantity: 20,
            available_quantity: 20,
          },
        },
      },
    })

    await prisma.events.create({
      data: {
        id: PAST_EVENT_ID,
        title: `Encore E2E ${runId} Past Showcase`,
        description: 'An isolated past-event browser test fixture.',
        venue: 'Encore E2E Test Hall',
        starts_at: new Date(Date.now() - 24 * 60 * 60 * 1000),
        status: 'published',
        ticket_types: {
          create: {
            name: 'Past Event Admission',
            price: '10.00',
            total_quantity: 5,
            available_quantity: 5,
          },
        },
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

async function cleanupFixtures() {
  const prisma = await getPrisma()
  try {
    const runId = process.env.E2E_RUN_ID
    const adminEmail = process.env.E2E_ADMIN_EMAIL
    const eventPrefix = eventTitlePrefix(runId)
    const customerPrefix = customerEmailPrefix(runId)
    const [users, events] = await Promise.all([
      prisma.users.findMany({
        where: { OR: [{ email: adminEmail }, { email: { startsWith: customerPrefix } }] },
        select: { id: true, email: true },
      }),
      prisma.events.findMany({
        where: { OR: [{ id: EVENT_ID }, { id: PAST_EVENT_ID }, { title: { startsWith: eventPrefix } }] },
        select: { id: true },
      }),
    ])
    // Second check in code: only the administrator or an exact-run customer is removed.
    const userIds = users
      .filter(({ email }) => email === adminEmail || isCustomerOfRun(email, runId))
      .map(({ id }) => id)
    const eventIds = events.map(({ id }) => id)
    const reservations = userIds.length
      ? await prisma.reservations.findMany({ where: { user_id: { in: userIds } }, select: { id: true } })
      : []
    const reservationIds = reservations.map(({ id }) => id)

    if (reservationIds.length) {
      // Payment attempts reference bookings and reservations, and webhook rows reference attempts,
      // so they are removed first. Only rows belonging to this run's reservations are touched.
      const attempts = await prisma.payment_attempts.findMany({
        where: { reservation_id: { in: reservationIds } },
        select: { id: true },
      })
      const attemptIds = attempts.map(({ id }) => id)
      if (attemptIds.length) {
        await prisma.stripe_webhook_events.deleteMany({ where: { payment_attempt_id: { in: attemptIds } } })
        await prisma.payment_attempts.deleteMany({ where: { id: { in: attemptIds } } })
      }
    }
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
    if (reservationIds.length) await prisma.reservations.deleteMany({ where: { id: { in: reservationIds } } })
    if (eventIds.length) {
      await prisma.ticket_types.deleteMany({ where: { event_id: { in: eventIds } } })
      await prisma.events.deleteMany({ where: { id: { in: eventIds } } })
    }
    if (userIds.length) await prisma.users.deleteMany({ where: { id: { in: userIds } } })
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  const command = process.argv[2]
  if (command === 'preflight') return preflight()
  if (command === 'fixtures') return createFixtures()
  if (command === 'cleanup') return cleanupFixtures()
  throw new Error('Choose one E2E database operation: preflight, fixtures, or cleanup.')
}

main().catch((error) => {
  const safeCode = typeof error.code === 'string' && /^[A-Z0-9]+$/.test(error.code)
    ? ` (${error.code})`
    : ''
  const safeMessage = error instanceof E2eSafetyError
    ? error.message
    : 'The database operation failed. Check the PostgreSQL service and Prisma command output; connection details were withheld.'
  console.error(`E2E database safety/setup failed${safeCode}: ${safeMessage}`)
  process.exitCode = 1
})
