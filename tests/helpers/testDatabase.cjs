const path = require('node:path')
const dotenv = require('../../server/node_modules/dotenv')

function validateTestDatabaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Database integration tests require TEST_DATABASE_URL. Set it to a dedicated PostgreSQL test database; DATABASE_URL is never used as a fallback.')
  }

  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL connection URL.')
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('TEST_DATABASE_URL must use the PostgreSQL protocol.')
  }
  let databaseName
  try {
    databaseName = decodeURIComponent(parsed.pathname.slice(1))
  } catch {
    throw new Error('TEST_DATABASE_URL must include a valid database name.')
  }
  if (!/(^|[_-])test($|[_-])/i.test(databaseName)) {
    throw new Error('The PostgreSQL database name in TEST_DATABASE_URL must include a distinct "test" segment (for example, encore_test).')
  }

  return value
}

const INTEGRATION_DATABASE = 'encore_test'
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

// Stricter than validateTestDatabaseUrl (which the E2E tooling reuses for its own database):
// the integration suites may only ever target the local database named exactly `encore_test`.
// Messages never echo the URL.
function validateIntegrationDatabaseUrl(value) {
  const validated = validateTestDatabaseUrl(value)
  const parsed = new URL(validated)
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(`Integration tests only run against a local PostgreSQL server; TEST_DATABASE_URL must use localhost or 127.0.0.1.`)
  }
  if (decodeURIComponent(parsed.pathname.slice(1)) !== INTEGRATION_DATABASE) {
    throw new Error(`Integration tests only run against the database named exactly ${INTEGRATION_DATABASE}.`)
  }
  if (parsed.searchParams.has('schema') && parsed.searchParams.get('schema') !== 'public') {
    throw new Error('Integration tests only run against the public schema.')
  }
  return validated
}

// Throws unless the live connection (not just the configured URL) is encore_test / public.
// Call it before the first count or write, outside any try block that rewrites errors.
async function assertConnectedToIntegrationDatabase(prisma) {
  const [identity] = await prisma.$queryRaw`SELECT current_database() AS database_name, current_schema() AS schema_name`
  if (identity?.database_name !== INTEGRATION_DATABASE || identity?.schema_name !== 'public') {
    throw new Error(`Connected to an unexpected integration-test database; expected ${INTEGRATION_DATABASE} / public. No data was read or changed.`)
  }
}

function configureTestDatabase() {
  // Read only the dedicated test file; never load server/.env as test configuration.
  const testEnvPath = path.resolve(__dirname, '../../server/.env.test')
  dotenv.config({ path: testEnvPath, quiet: true })

  const testDatabaseUrl = validateIntegrationDatabaseUrl(process.env.TEST_DATABASE_URL)
  // Prisma's existing singleton reads DATABASE_URL; point it explicitly at the test DB.
  process.env.DATABASE_URL = testDatabaseUrl
}

module.exports = {
  INTEGRATION_DATABASE,
  validateTestDatabaseUrl,
  validateIntegrationDatabaseUrl,
  assertConnectedToIntegrationDatabase,
  configureTestDatabase,
}
