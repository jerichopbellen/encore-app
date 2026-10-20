const test = require('node:test')
const assert = require('node:assert/strict')
const Stripe = require('../../server/node_modules/stripe')

// Encore branches on these classes and codes. They are asserted against the installed SDK so an
// SDK upgrade that changes the classification fails here instead of silently in production.
const generate = (raw) => Stripe.errors.generateV1Error({ message: 'test', ...raw })

test('a session that is not open is reported as StripeInvalidRequestError', () => {
  const error = generate({ type: 'invalid_request_error', statusCode: 400 })
  assert.equal(error.type, 'StripeInvalidRequestError')
})

test('an idempotency parameter mismatch (HTTP 400) is a StripeIdempotencyError', () => {
  const error = generate({ type: 'idempotency_error', statusCode: 400 })
  assert.equal(error.type, 'StripeIdempotencyError')
})

test('an in-progress idempotency key (HTTP 409) is a StripeAPIError carrying the code, so Encore matches the code', () => {
  const error = generate({ type: 'idempotency_error', code: 'idempotency_key_in_use', statusCode: 409 })
  assert.equal(error.type, 'StripeAPIError')
  assert.equal(error.code, 'idempotency_key_in_use')
})

test('server, rate-limit and connection failures are not invalid-request errors', () => {
  assert.equal(generate({ type: 'api_error', statusCode: 500 }).type, 'StripeAPIError')
  assert.equal(generate({ type: 'rate_limit_error', statusCode: 429 }).type, 'StripeRateLimitError')
  assert.equal(new Stripe.errors.StripeConnectionError({ message: 'down' }).type, 'StripeConnectionError')
})
