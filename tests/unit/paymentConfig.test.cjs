const test = require('node:test')
const assert = require('node:assert/strict')
const {
  getPaymentMode,
  validatePaymentEnvironment,
  SESSION_LIFETIME_MINUTES,
  HOLD_GRACE_MINUTES,
  MAX_HOLD_MINUTES,
} = require('../../server/src/config/payments')
const { validateEnvironment } = require('../../server/src/config/environment')

const stripeConfig = {
  PAYMENT_PROVIDER: 'stripe',
  STRIPE_SECRET_KEY: 'sk_test_unit_test_placeholder',
  STRIPE_WEBHOOK_SECRET: 'whsec_unit_test_placeholder',
  FRONTEND_ORIGIN: 'http://localhost:5173',
}

test('payment mode defaults to simulated and rejects unknown providers', () => {
  assert.equal(getPaymentMode({}), 'simulated')
  assert.equal(getPaymentMode({ PAYMENT_PROVIDER: '  Simulated ' }), 'simulated')
  assert.equal(getPaymentMode({ PAYMENT_PROVIDER: 'STRIPE' }), 'stripe')
  assert.throws(() => getPaymentMode({ PAYMENT_PROVIDER: 'paypal' }), /PAYMENT_PROVIDER must be one of/)
  assert.throws(() => validateEnvironment({ PAYMENT_PROVIDER: 'paypal' }), /PAYMENT_PROVIDER/)
})

test('simulated mode needs no Stripe configuration', () => {
  assert.deepEqual(validatePaymentEnvironment({}), { provider: 'simulated' })
  assert.doesNotThrow(() => validateEnvironment({ PAYMENT_PROVIDER: 'simulated' }))
})

test('stripe mode requires test-mode keys, a webhook secret, and an exact frontend origin', () => {
  assert.deepEqual(validatePaymentEnvironment(stripeConfig), { provider: 'stripe' })
  assert.doesNotThrow(() => validateEnvironment(stripeConfig))
  for (const patch of [
    { STRIPE_SECRET_KEY: '' },
    { STRIPE_SECRET_KEY: 'sk_live_not_allowed_here' },
    { STRIPE_SECRET_KEY: 'pk_test_publishable_is_not_a_secret' },
    { STRIPE_WEBHOOK_SECRET: '' },
    { STRIPE_WEBHOOK_SECRET: 'not-a-webhook-secret' },
    { FRONTEND_ORIGIN: '' },
    { FRONTEND_ORIGIN: 'http://localhost:5173/path' },
    { FRONTEND_ORIGIN: 'not a url' },
  ]) {
    assert.throws(() => validatePaymentEnvironment({ ...stripeConfig, ...patch }), undefined, JSON.stringify(Object.keys(patch)))
  }
})

test('configuration errors never echo secret values', () => {
  for (const patch of [
    { STRIPE_SECRET_KEY: 'sk_live_super_secret_value' },
    { STRIPE_WEBHOOK_SECRET: 'definitely-not-whsec-secret-value' },
  ]) {
    try {
      validatePaymentEnvironment({ ...stripeConfig, ...patch })
      assert.fail('expected a configuration error')
    } catch (error) {
      for (const value of Object.values(patch)) assert.equal(error.message.includes(value), false)
    }
  }
})

test('an elapsed Stripe session can never be replaced within the hold cap', () => {
  // startPayment offers no replacement once an open session has run out: that session started after the
  // reservation, and a new one needs a full session plus the grace period of hold. If these values change so
  // that a replacement could fit, startPayment must create one again instead of rejecting the request.
  assert.ok(SESSION_LIFETIME_MINUTES >= 30, 'Stripe requires Checkout Sessions to stay open for at least 30 minutes.')
  assert.ok(SESSION_LIFETIME_MINUTES + SESSION_LIFETIME_MINUTES + HOLD_GRACE_MINUTES > MAX_HOLD_MINUTES)
})
