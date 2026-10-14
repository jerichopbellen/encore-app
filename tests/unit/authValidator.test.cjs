const test = require('node:test')
const assert = require('node:assert/strict')
const {
  normalizeRegistrationInput,
  normalizeLoginInput,
  normalizeProfileUpdateInput,
} = require('../../server/src/validators/authValidator')

test('registration trims names and normalizes email addresses', () => {
  assert.deepEqual(
    normalizeRegistrationInput({ name: '  Alex Rivera ', email: ' ALEX@Example.com ', password: 'valid-password' }),
    { name: 'Alex Rivera', email: 'alex@example.com', password: 'valid-password' },
  )
})

test('registration rejects missing fields, malformed email, and passwords over bcrypt byte limit', () => {
  for (const input of [
    {},
    { name: 'Alex', email: 'not-an-email', password: 'valid-password' },
    { name: 'Alex', email: 'alex@example.com', password: 'short' },
    { name: 'Alex', email: 'alex@example.com', password: 'é'.repeat(37) },
  ]) {
    assert.throws(() => normalizeRegistrationInput(input), (error) => error.statusCode === 400)
  }
})

test('login normalizes email but preserves the password exactly', () => {
  assert.deepEqual(normalizeLoginInput({ email: ' ALEX@Example.com ', password: '  valid-password  ' }), {
    email: 'alex@example.com',
    password: '  valid-password  ',
  })
})

test('profile updates trim names and reject blank or overlong names', () => {
  assert.deepEqual(normalizeProfileUpdateInput({ name: '  Alex  ' }), { name: 'Alex' })
  assert.throws(() => normalizeProfileUpdateInput({ name: '  ' }), (error) => error.statusCode === 400)
  assert.throws(() => normalizeProfileUpdateInput({ name: 'a'.repeat(101) }), (error) => error.statusCode === 400)
})
