const { Client } = require('pg')
const bcrypt = require('bcrypt')
const { validateTestDatabaseUrl } = require('../../tests/helpers/testDatabase.cjs')
const {
  E2eSafetyError,
  EXPECTED_DATABASE,
  validateE2eDatabaseTarget,
} = require('../../client/e2e/support/databaseSafety.cjs')

const EVENT_ID = 'a2000000-0000-4000-8000-000000000001'
const APP_TABLES = [
  'users',
  'events',
  'ticket_types',
  'reservations',
  'reservation_items',
  'bookings',
  'idempotency_keys',
]

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
    if (identity.rows[0]?.database_name !== EXPECTED_DATABASE || identity.rows[0]?.schema_name !== 'public') {
      throw new E2eSafetyError(`Connected to an unexpected E2E database; expected ${EXPECTED_DATABASE} / public.`)
    }

    const tables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    )
    if (tables.rowCount > 0) {
      throw new E2eSafetyError('The E2E database schema is not empty. Use a fresh disposable E2E database; no data was changed.')
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
  return getPrismaClient()
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
  } finally {
    await prisma.$disconnect()
  }
}

async function cleanupFixtures() {
  const prisma = await getPrisma()
  try {
    const runId = process.env.E2E_RUN_ID
    const adminEmail = process.env.E2E_ADMIN_EMAIL
    const eventPrefix = `Encore E2E ${runId} `
    const customerPrefix = `encore-e2e-${runId}-`
    const [users, events] = await Promise.all([
      prisma.users.findMany({
        where: { OR: [{ email: adminEmail }, { email: { startsWith: customerPrefix } }] },
        select: { id: true },
      }),
      prisma.events.findMany({
        where: { OR: [{ id: EVENT_ID }, { title: { startsWith: eventPrefix } }] },
        select: { id: true },
      }),
    ])
    const userIds = users.map(({ id }) => id)
    const eventIds = events.map(({ id }) => id)
    const reservations = userIds.length
      ? await prisma.reservations.findMany({ where: { user_id: { in: userIds } }, select: { id: true } })
      : []
    const reservationIds = reservations.map(({ id }) => id)

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
