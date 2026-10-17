const { validateTestDatabaseUrl } = require('../../../tests/helpers/testDatabase.cjs')

const REQUIRED_URLS = ['TEST_DATABASE_URL', 'DATABASE_URL', 'DIRECT_DATABASE_URL']
const EXPECTED_DATABASE = 'encore_e2e_test'
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost'])

class E2eSafetyError extends Error {
  constructor(message) {
    super(message)
    this.name = 'E2eSafetyError'
  }
}

function describeDatabaseTarget(value, variableName) {
  let url
  try {
    url = new URL(validateTestDatabaseUrl(value))
  } catch (error) {
    const validationMessage = typeof error.message === 'string' && !error.message.includes(value || '\u0000')
      ? error.message
      : 'must be a valid PostgreSQL URL with a distinct test database name.'
    throw new E2eSafetyError(`${variableName}: ${validationMessage}`)
  }

  let databaseName
  try {
    databaseName = decodeURIComponent(url.pathname.slice(1))
  } catch {
    throw new E2eSafetyError(`${variableName} must include a valid E2E database name.`)
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !LOOPBACK_HOSTS.has(url.hostname)
    || databaseName !== EXPECTED_DATABASE
    || (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public')) {
    throw new E2eSafetyError(`${variableName} must target local PostgreSQL database ${EXPECTED_DATABASE} in the public schema.`)
  }

  return { hostname: url.hostname, port: url.port || '5432', databaseName }
}

function validateE2eDatabaseTarget() {
  const values = REQUIRED_URLS.map((name) => {
    const value = process.env[name]
    if (!value) throw new E2eSafetyError(`${name} is required; E2E tests never fall back to another database URL.`)
    return { name, value, target: describeDatabaseTarget(value, name) }
  })

  if (values.some(({ value }) => value !== values[0].value)) {
    throw new E2eSafetyError('TEST_DATABASE_URL, DATABASE_URL, and DIRECT_DATABASE_URL must be the same E2E database URL.')
  }

  if (!process.env.E2E_RUN_ID || !/^[a-zA-Z0-9-]{1,80}$/.test(process.env.E2E_RUN_ID)) {
    throw new E2eSafetyError('E2E_RUN_ID must be provided as a short alphanumeric test-run identifier.')
  }
  if (!process.env.E2E_ADMIN_EMAIL || !process.env.E2E_ADMIN_EMAIL.endsWith('@example.test')) {
    throw new E2eSafetyError('E2E_ADMIN_EMAIL must use the reserved example.test test domain.')
  }
  if (!process.env.E2E_ADMIN_PASSWORD || process.env.E2E_ADMIN_PASSWORD.length < 12) {
    throw new E2eSafetyError('E2E_ADMIN_PASSWORD must be provided as a test-only password of at least 12 characters.')
  }
  if (process.env.E2E_EVENT_ID !== 'a2000000-0000-4000-8000-000000000001') {
    throw new E2eSafetyError('E2E_EVENT_ID must match the reserved event fixture identifier.')
  }

  return values[0].target
}

module.exports = { E2eSafetyError, EXPECTED_DATABASE, validateE2eDatabaseTarget }
