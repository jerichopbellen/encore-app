const assert = require('node:assert/strict')
const test = require('node:test')
const { serverRequire } = require('../helpers/listen.cjs')
const express = serverRequire('express')
const { parseTrustProxyHops, validateEnvironment } = require('../../server/src/config/environment')
const { getRateLimitConfig } = require('../../server/src/config/rateLimit')
const { configureTrustProxy } = require('../../server/src/middleware/rateLimiters')

const MINUTE = 60 * 1000

const productionConfig = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@db.example.test:5432/encore?sslmode=require',
  JWT_SECRET: 'a-realistic-random-secret-of-at-least-32-bytes',
  FRONTEND_ORIGIN: 'https://encore.example.com',
}

test('the initial proposed limits are the defaults', () => {
  const { limits, maxKeys } = getRateLimitConfig({ NODE_ENV: 'development' })
  assert.deepEqual(limits.loginIp, { limit: 20, windowMs: 15 * MINUTE })
  assert.deepEqual(limits.loginFailure, { limit: 5, windowMs: 15 * MINUTE })
  assert.deepEqual(limits.loginFailureNoIp, { limit: 50, windowMs: 60 * MINUTE })
  assert.deepEqual(limits.registration, { limit: 5, windowMs: 60 * MINUTE })
  assert.deepEqual(limits.reservationCreation, { limit: 10, windowMs: 10 * MINUTE })
  assert.deepEqual(limits.reservationAttempt, { limit: 60, windowMs: 10 * MINUTE })
  assert.deepEqual(limits.reservationIp, { limit: 30, windowMs: 10 * MINUTE })
  assert.deepEqual(limits.reservationCancel, { limit: 30, windowMs: 10 * MINUTE })
  assert.deepEqual(limits.reservationRead, { limit: 200, windowMs: 10 * MINUTE })
  assert.deepEqual(limits.paymentInitiation, { limit: 10, windowMs: 10 * MINUTE })
  assert.deepEqual(limits.paymentCancellation, { limit: 20, windowMs: 10 * MINUTE })
  assert.deepEqual(limits.posterMutation, { limit: 20, windowMs: 10 * MINUTE })
  assert.deepEqual(limits.generalRead, { limit: 300, windowMs: 15 * MINUTE })
  assert.equal(maxKeys, 10000)
})

test('limits and windows can be overridden through environment variables', () => {
  const { limits, maxKeys } = getRateLimitConfig({
    RATE_LIMIT_LOGIN_IP_MAX: '7',
    RATE_LIMIT_LOGIN_IP_WINDOW_MINUTES: '3',
    RATE_LIMIT_MAX_KEYS: '500',
  })
  assert.deepEqual(limits.loginIp, { limit: 7, windowMs: 3 * MINUTE })
  assert.equal(limits.loginFailure.limit, 5)
  assert.equal(maxKeys, 500)
})

test('malformed limit settings fail startup without echoing the value', () => {
  for (const [name, value] of [
    ['RATE_LIMIT_LOGIN_IP_MAX', '0'],
    ['RATE_LIMIT_LOGIN_IP_MAX', '-5'],
    ['RATE_LIMIT_LOGIN_IP_MAX', 'abc'],
    ['RATE_LIMIT_LOGIN_IP_MAX', '1.5'],
    ['RATE_LIMIT_REGISTRATION_WINDOW_MINUTES', '99999'],
    ['RATE_LIMIT_MAX_KEYS', '5'],
  ]) {
    assert.throws(() => getRateLimitConfig({ [name]: value }), (error) => {
      assert.match(error.message, new RegExp(name))
      assert.ok(!error.message.includes(`"${value}"`))
      return true
    }, `${name}=${value}`)
  }
})

test('TRUST_PROXY_HOPS accepts only a small whole number, and unset means unverified', () => {
  assert.equal(parseTrustProxyHops(undefined), null)
  assert.equal(parseTrustProxyHops(''), null)
  assert.equal(parseTrustProxyHops('  '), null)
  assert.equal(parseTrustProxyHops('0'), 0)
  assert.equal(parseTrustProxyHops('2'), 2)
  assert.equal(parseTrustProxyHops(' 1 '), 1)
  for (const bad of ['true', 'false', 'loopback', '-1', '1.5', '6', '99', '1,2', '0x1']) {
    assert.throws(() => parseTrustProxyHops(bad), /TRUST_PROXY_HOPS/, bad)
  }
})

test('TRUST_PROXY_HOPS=0 is rejected in production but allowed elsewhere', () => {
  assert.throws(() => parseTrustProxyHops('0', { production: true }), /not allowed in production/)
  assert.throws(() => getRateLimitConfig({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '0' }), /not allowed in production/)
  assert.throws(() => validateEnvironment({ ...productionConfig, TRUST_PROXY_HOPS: '0' }), /TRUST_PROXY_HOPS=0/)
  assert.equal(parseTrustProxyHops('0'), 0)
  assert.equal(getRateLimitConfig({ NODE_ENV: 'development', TRUST_PROXY_HOPS: '0' }).trustProxyHops, 0)
  // A real hop count is accepted in production, and unset stays unverified.
  assert.equal(validateEnvironment({ ...productionConfig, TRUST_PROXY_HOPS: '2' }).port, 5000)
  assert.equal(getRateLimitConfig({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '2' }).trustProxyHops, 2)
  assert.equal(getRateLimitConfig({ ...productionConfig }).trustProxyHops, null)
})

test('startup validation rejects an invalid TRUST_PROXY_HOPS or RATE_LIMIT_* value', () => {
  assert.doesNotThrow(() => validateEnvironment({ NODE_ENV: 'development', TRUST_PROXY_HOPS: '1' }))
  assert.throws(() => validateEnvironment({ NODE_ENV: 'development', TRUST_PROXY_HOPS: 'true' }), /TRUST_PROXY_HOPS/)
  assert.throws(() => validateEnvironment({ NODE_ENV: 'development', RATE_LIMIT_GENERAL_READ_MAX: 'lots' }), /RATE_LIMIT_GENERAL_READ_MAX/)
})

const HOPS_VARIANTS = [undefined, '1', '2', '3', '5']
const withHops = (env, hops) => (hops === undefined ? env : { ...env, TRUST_PROXY_HOPS: hops })

test('production never enables IP-based limiting, whether TRUST_PROXY_HOPS is set or unset', () => {
  for (const hops of HOPS_VARIANTS) {
    const config = getRateLimitConfig(withHops({ NODE_ENV: 'production' }, hops))
    assert.equal(config.ipLimitingEnabled, false, `TRUST_PROXY_HOPS=${hops}`)
    // Express must not be told to trust a proxy either, because that would only serve IP limiting.
    assert.equal(config.effectiveTrustProxyHops, null, `TRUST_PROXY_HOPS=${hops}`)
  }
})

test('production still parses and validates TRUST_PROXY_HOPS even though the value is ignored', () => {
  assert.equal(getRateLimitConfig({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '3' }).trustProxyHops, 3)
  assert.equal(getRateLimitConfig({ NODE_ENV: 'production' }).trustProxyHops, null)
  assert.throws(() => getRateLimitConfig({ NODE_ENV: 'production', TRUST_PROXY_HOPS: 'true' }), /TRUST_PROXY_HOPS/)
  assert.throws(() => getRateLimitConfig({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '9' }), /TRUST_PROXY_HOPS/)
})

test('an unset or unexpected NODE_ENV never enables IP-based limiting', () => {
  const unexpectedValues = [
    undefined, '', ' ', 'staging', 'stage', 'prod', 'Production', 'PRODUCTION', ' production ', 'production ',
    'Development', 'DEVELOPMENT', 'Test', 'TEST', 'dev', 'local', 'qa', 'preview', 'live', 'true', '1',
  ]
  for (const nodeEnv of unexpectedValues) {
    for (const hops of HOPS_VARIANTS) {
      const env = nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv }
      const config = getRateLimitConfig(withHops(env, hops))
      assert.equal(config.ipLimitingEnabled, false, `NODE_ENV=${JSON.stringify(nodeEnv)} TRUST_PROXY_HOPS=${hops}`)
      assert.equal(config.effectiveTrustProxyHops, null, `NODE_ENV=${JSON.stringify(nodeEnv)} TRUST_PROXY_HOPS=${hops}`)
    }
  }
})

test('development and test keep IP-based limiting on, and apply TRUST_PROXY_HOPS only there', () => {
  for (const nodeEnv of ['development', 'test']) {
    const unset = getRateLimitConfig({ NODE_ENV: nodeEnv })
    assert.equal(unset.ipLimitingEnabled, true, nodeEnv)
    assert.equal(unset.effectiveTrustProxyHops, null, nodeEnv)

    assert.equal(getRateLimitConfig({ NODE_ENV: nodeEnv, TRUST_PROXY_HOPS: '2' }).effectiveTrustProxyHops, 2, nodeEnv)
    assert.equal(getRateLimitConfig({ NODE_ENV: nodeEnv, TRUST_PROXY_HOPS: '0' }).ipLimitingEnabled, true, nodeEnv)
  }
})

test('the limit values are the same in every environment, so account-keyed limits are never switched off by it', () => {
  const production = getRateLimitConfig({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '3' }).limits
  const development = getRateLimitConfig({ NODE_ENV: 'development' }).limits
  assert.deepEqual(production, development)
  for (const accountKeyed of ['reservationAttempt', 'reservationCreation', 'reservationCancel', 'reservationRead',
    'paymentInitiation', 'paymentCancellation', 'posterMutation', 'loginFailureNoIp']) {
    assert.ok(production[accountKeyed].limit > 0, accountKeyed)
  }
})

test('configureTrustProxy sets only a verified whole hop count and never true', () => {
  const unset = express()
  configureTrustProxy(unset, null)
  assert.equal(unset.get('trust proxy'), false)

  const zero = express()
  configureTrustProxy(zero, 0)
  assert.equal(zero.get('trust proxy'), false)

  const verified = express()
  configureTrustProxy(verified, 2)
  assert.equal(verified.get('trust proxy'), 2)

  const unsafe = express()
  configureTrustProxy(unsafe, true)
  assert.equal(unsafe.get('trust proxy'), false)
})
