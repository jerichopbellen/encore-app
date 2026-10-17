const test = require('node:test')
const assert = require('node:assert/strict')
const { parsePort, validateEnvironment } = require('../../server/src/config/environment')

const productionConfig = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@db.example.test:5432/encore?sslmode=require',
  DIRECT_DATABASE_URL: 'postgresql://user:password@db.example.test:5432/encore?sslmode=require',
  JWT_SECRET: 'a-realistic-random-secret-of-at-least-32-bytes',
  FRONTEND_ORIGIN: 'https://encore.example.com',
}

test('port configuration uses a local fallback and validates deployment values', () => {
  assert.equal(parsePort(undefined), 5000)
  assert.equal(parsePort('10000'), 10000)
  for (const value of ['0', '65536', 'abc', '3.5']) {
    assert.throws(() => parsePort(value), /PORT must be an integer/)
  }
  assert.deepEqual(validateEnvironment({ NODE_ENV: 'development', PORT: '5174' }), {
    port: 5174, host: '0.0.0.0', cookieSameSite: 'lax',
  })
})

test('production configuration requires valid secret, TLS database URLs, and exact HTTPS origin', () => {
  assert.deepEqual(validateEnvironment(productionConfig), {
    port: 5000, host: '0.0.0.0', cookieSameSite: 'lax',
  })
  for (const patch of [
    { DATABASE_URL: '' },
    { DATABASE_URL: 'postgresql://user:password@db.example.test/encore' },
    { JWT_SECRET: 'short' },
    { JWT_SECRET: 'replace-with-a-real-secret-that-is-long-enough' },
    { FRONTEND_ORIGIN: 'http://encore.example.com' },
    { FRONTEND_ORIGIN: 'https://encore.example.com/path' },
  ]) {
    assert.throws(() => validateEnvironment({ ...productionConfig, ...patch }))
  }
})

test('SameSite=None is restricted to production HTTPS cookie configuration', () => {
  assert.throws(() => validateEnvironment({ NODE_ENV: 'development', COOKIE_SAME_SITE: 'none' }), /requires production HTTPS/)
  assert.throws(() => validateEnvironment({ ...productionConfig, COOKIE_SAME_SITE: 'invalid' }), /COOKIE_SAME_SITE/)
  assert.equal(validateEnvironment({ ...productionConfig, COOKIE_SAME_SITE: 'none' }).cookieSameSite, 'none')
})
