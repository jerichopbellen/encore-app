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
