const AppError = require('../utils/AppError')

function normalizeRegistrationInput(body = {}) {
  const { name, email, password } = body ?? {}

  if (
    typeof name !== 'string' ||
    typeof email !== 'string' ||
    typeof password !== 'string' ||
    !name.trim() ||
    !email.trim() ||
    !password
  ) {
    throw new AppError('Name, email, and password are required.', 400)
  }

  const normalizedName = name.trim()
  const normalizedEmail = email.trim().toLowerCase()

  if (normalizedName.length > 100 || normalizedEmail.length > 255) {
    throw new AppError('Name or email exceeds the maximum allowed length.', 400)
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new AppError('Enter a valid email address.', 400)
  }

  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new AppError('Password must be 8 to 72 UTF-8 bytes long.', 400)
  }

  return { name: normalizedName, email: normalizedEmail, password }
}

function normalizeLoginInput(body = {}) {
  const { email, password } = body ?? {}

  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    throw new AppError('Email and password are required.', 400)
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    throw new AppError('Password must not exceed 72 UTF-8 bytes.', 400)
  }

  return { email: email.trim().toLowerCase(), password }
}

module.exports = { normalizeRegistrationInput, normalizeLoginInput }
