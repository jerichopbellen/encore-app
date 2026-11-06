const test = require('node:test')
const assert = require('node:assert/strict')
const { validateTestDatabaseUrl } = require('../helpers/testDatabase.cjs')

test('test database guard accepts an explicitly named dedicated PostgreSQL database', () => {
  assert.equal(
    validateTestDatabaseUrl('postgresql://localhost:5432/encore_test?schema=public'),
    'postgresql://localhost:5432/encore_test?schema=public',
  )
})

test('test database guard rejects absent, non-PostgreSQL, and development URLs without echoing them', () => {
  assert.throws(() => validateTestDatabaseUrl(undefined), /TEST_DATABASE_URL/)
  assert.throws(() => validateTestDatabaseUrl('mysql://localhost/encore_test'), /PostgreSQL/)
  assert.throws(() => validateTestDatabaseUrl('postgresql://localhost/encore'), /distinct/)
  assert.throws(
    () => validateTestDatabaseUrl('postgresql://localhost/encore'),
    (error) => !error.message.includes('localhost/encore'),
  )
})

const {
  validateIntegrationDatabaseUrl,
  assertConnectedToIntegrationDatabase,
} = require('../helpers/testDatabase.cjs')

test('integration guard accepts only the local database named exactly encore_test', () => {
  for (const url of [
    'postgresql://localhost:5432/encore_test',
    'postgresql://user:pw@127.0.0.1:5432/encore_test?schema=public',
    'postgres://[::1]:5432/encore_test',
  ]) {
    assert.equal(validateIntegrationDatabaseUrl(url), url)
  }
})

test('integration guard rejects other databases, remote hosts and other schemas without echoing the URL', () => {
  for (const [url, pattern] of [
    ['postgresql://localhost:5432/encore_e2e_test', /named exactly encore_test/],
    ['postgresql://localhost:5432/encore_stripe_test', /named exactly encore_test/],
    ['postgresql://localhost:5432/encore', /distinct/],
    ['postgresql://db.example.neon.tech:5432/encore_test', /local PostgreSQL server/],
    ['postgresql://10.0.0.5:5432/encore_test', /local PostgreSQL server/],
    ['postgresql://localhost:5432/encore_test?schema=other', /public schema/],
    ['mysql://localhost/encore_test', /PostgreSQL/],
    [undefined, /TEST_DATABASE_URL/],
  ]) {
    assert.throws(() => validateIntegrationDatabaseUrl(url), pattern, String(url))
  }
  assert.throws(
    () => validateIntegrationDatabaseUrl('postgresql://user:secretpw@db.example.neon.tech/encore_test'),
    (error) => !error.message.includes('secretpw') && !error.message.includes('neon.tech'),
  )
})

test('the live-connection check passes only for encore_test / public', async () => {
  const connected = (identity) => ({ $queryRaw: async () => [identity] })
  await assert.doesNotReject(assertConnectedToIntegrationDatabase(connected({ database_name: 'encore_test', schema_name: 'public' })))
  for (const identity of [
    { database_name: 'encore', schema_name: 'public' },
    { database_name: 'encore_e2e_test', schema_name: 'public' },
    { database_name: 'encore_test', schema_name: 'other' },
    undefined,
  ]) {
    await assert.rejects(assertConnectedToIntegrationDatabase(connected(identity)), /unexpected integration-test database/)
  }
})
