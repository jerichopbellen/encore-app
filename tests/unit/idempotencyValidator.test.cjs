const test = require('node:test')
const assert = require('node:assert/strict')
const { validateIdempotencyKey } = require('../../server/src/validators/idempotencyValidator')

test('checkout idempotency keys accept supported values within the database limit', () => {
  assert.equal(validateIdempotencyKey('checkout-1234._~'), 'checkout-1234._~')
  assert.equal(validateIdempotencyKey('a'.repeat(255)), 'a'.repeat(255))
})

test('checkout idempotency keys reject missing, short, oversized, or malformed values', () => {
  for (const value of [undefined, '', 'short', 'a'.repeat(256), 'has spaces', 'line\nbreak', 'comma,value']) {
    assert.throws(() => validateIdempotencyKey(value), { statusCode: 400 })
  }
})
