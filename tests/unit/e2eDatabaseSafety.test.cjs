const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const {
  APP_TABLES,
  E2eSafetyError,
  EXPECTED_TABLES,
  assertConnectedToE2eDatabase,
  customerEmailPrefix,
  eventTitlePrefix,
  isCustomerOfRun,
  validateE2eDatabaseTarget,
} = require('../../client/e2e/support/databaseSafety.cjs')

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

test('cleanup matching cannot reach another run whose ID extends this one', () => {
  const customerOf = (runId) => `${customerEmailPrefix(runId)}booking-0b7d6c1e-0000-4000-8000-000000000001@example.test`

  assert.equal(isCustomerOfRun(customerOf('local'), 'local'), true)
  assert.equal(isCustomerOfRun(customerOf('local-m2-1'), 'local-m2-1'), true)
  // The collision this guards against: "local" must not match "local-m2-1" users.
  assert.equal(isCustomerOfRun(customerOf('local-m2-1'), 'local'), false)
  assert.equal(isCustomerOfRun(customerOf('local'), 'local-m2-1'), false)
  // CI run IDs have the same "<run>-<attempt>" shape.
  assert.equal(isCustomerOfRun(customerOf('123-10'), '123-1'), false)
  assert.equal(isCustomerOfRun(customerOf('123-1'), '123-10'), false)
  assert.equal(isCustomerOfRun(undefined, 'local'), false)

  // No valid run ID contains the "." that ends the customer prefix, and event titles end in a space.
  assert.equal(customerEmailPrefix('local').endsWith('.'), true)
  assert.equal(eventTitlePrefix('local'), 'Encore E2E local ')
  assert.equal('Encore E2E local-m2-1 Reservation Night'.startsWith(eventTitlePrefix('local')), false)
})

test('live database identity must be exactly encore_e2e_test in the public schema', () => {
  assert.doesNotThrow(() => assertConnectedToE2eDatabase({ database_name: 'encore_e2e_test', schema_name: 'public' }))
  for (const identity of [
    { database_name: 'encore', schema_name: 'public' },
    { database_name: 'encore_test', schema_name: 'public' },
    { database_name: 'encore_migration_test', schema_name: 'public' },
    { database_name: 'encore_stripe_check', schema_name: 'public' },
    { database_name: 'encore_e2e_test', schema_name: 'other' },
    { database_name: 'encore_e2e_test' },
    {},
    undefined,
  ]) {
    assert.throws(() => assertConnectedToE2eDatabase(identity), E2eSafetyError)
  }
})

test('the expected E2E tables match the Prisma schema and every one is checked for emptiness', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../../server/prisma/schema.prisma'), 'utf8')
  assert.equal(/@@map/.test(schema), false, 'Model names are table names only while the schema has no @@map.')
  const models = [...schema.matchAll(/^model (\w+) \{/gm)].map((match) => match[1]).sort()

  assert.deepEqual([...APP_TABLES].sort(), models)
  assert.equal(APP_TABLES.includes('event_poster_cleanups'), true)
  assert.deepEqual([...EXPECTED_TABLES].sort(), [...models, '_prisma_migrations'].sort())
})

test('npm run test:e2e runs the database preflight first', () => {
  const { scripts } = JSON.parse(fs.readFileSync(path.join(__dirname, '../../client/package.json'), 'utf8'))
  assert.equal(scripts['test:e2e'], 'playwright test')
  assert.equal(scripts['pretest:e2e'], 'node ../server/scripts/e2e-database.cjs preflight')
})
