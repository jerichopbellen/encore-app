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

function configureTestDatabase() {
  // Read only the dedicated test file; never load server/.env as test configuration.
  const testEnvPath = path.resolve(__dirname, '../../server/.env.test')
  dotenv.config({ path: testEnvPath, quiet: true })

  const testDatabaseUrl = validateTestDatabaseUrl(process.env.TEST_DATABASE_URL)
  // Prisma's existing singleton reads DATABASE_URL; point it explicitly at the test DB.
  process.env.DATABASE_URL = testDatabaseUrl
}

module.exports = { validateTestDatabaseUrl, configureTestDatabase }
