const assert = require('node:assert/strict')
const test = require('node:test')
const { validateE2eDatabaseTarget } = require('../../client/e2e/support/databaseSafety.cjs')

const validUrl = 'postgresql://e2e:e2e@127.0.0.1:5432/encore_e2e_test?schema=public'
const validEnvironment = {
  TEST_DATABASE_URL: validUrl,
  DATABASE_URL: validUrl,
  DIRECT_DATABASE_URL: validUrl,
  E2E_RUN_ID: 'unit-test-1',
  E2E_ADMIN_EMAIL: 'encore-e2e-unit-test-1@example.test',
  E2E_ADMIN_PASSWORD: 'e2e-only-password-long',
  E2E_EVENT_ID: 'a2000000-0000-4000-8000-000000000001',
}

function withEnvironment(values, callback) {
  const original = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]))
  try {
    Object.assign(process.env, values)
    return callback()
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

test('E2E database guard accepts only the explicit local E2E target', () => {
  withEnvironment(validEnvironment, () => {
    assert.deepEqual(validateE2eDatabaseTarget(), {
      hostname: '127.0.0.1',
      port: '5432',
      databaseName: 'encore_e2e_test',
    })
  })
})

test('E2E database guard rejects absent URLs and development database names', () => {
  withEnvironment({ ...validEnvironment, DIRECT_DATABASE_URL: '' }, () => {
    assert.throws(() => validateE2eDatabaseTarget(), /DIRECT_DATABASE_URL is required/)
  })
  withEnvironment({ ...validEnvironment, TEST_DATABASE_URL: validUrl.replace('encore_e2e_test', 'encore') }, () => {
    assert.throws(() => validateE2eDatabaseTarget(), /distinct "test" segment/)
  })
})

test('E2E database guard rejects remote hosts and mismatched database URLs', () => {
  const remoteUrl = validUrl.replace('127.0.0.1', 'staging.example.neon.tech')
  withEnvironment({ ...validEnvironment, TEST_DATABASE_URL: remoteUrl, DATABASE_URL: remoteUrl, DIRECT_DATABASE_URL: remoteUrl }, () => {
    assert.throws(() => validateE2eDatabaseTarget(), /local PostgreSQL database encore_e2e_test/)
  })
  withEnvironment({ ...validEnvironment, DIRECT_DATABASE_URL: validUrl.replace('e2e:e2e', 'e2e:other') }, () => {
    assert.throws(() => validateE2eDatabaseTarget(), /must be the same E2E database URL/)
  })
})
