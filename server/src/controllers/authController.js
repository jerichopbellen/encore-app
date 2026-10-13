const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const AppError = require('../utils/AppError')
const authService = require('../services/authService')
const {
  normalizeRegistrationInput,
  normalizeLoginInput,
  normalizeProfileUpdateInput,
} = require('../validators/authValidator')

const COOKIE_NAME = 'encore_session'
const JWT_ISSUER = 'encore-api'
const JWT_AUDIENCE = 'encore-client'
const JWT_ALGORITHM = 'HS256'

function getJwtSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 bytes.')
  }
  return secret
}

function getCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  }
}

function createSessionToken(userId) {
  const expiresIn = process.env.JWT_EXPIRES_IN || '1d'
  const token = jwt.sign({}, getJwtSecret(), {
    algorithm: JWT_ALGORITHM,
    subject: userId,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn,
  })
  const claims = jwt.decode(token)
  return { token, maxAge: (claims.exp - claims.iat) * 1000 }
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    created_at: user.created_at,
  }
}

async function register(req, res) {
  const input = normalizeRegistrationInput(req.body)

  try {
    const user = await authService.registerUser(input)
    return res.status(201).json({ success: true, data: { user } })
  } catch (error) {
    // PostgreSQL's unique index is the final guard if two requests race.
    if (error.code === 'P2002') {
      throw new AppError('An account with this email already exists.', 409)
    }
    throw error
  }
}

async function login(req, res) {
  const { email, password } = normalizeLoginInput(req.body)
  const user = await authService.findUserByEmail(email)

  // Return the same message for an unknown email and a wrong password.
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError('Invalid email or password.', 401)
  }

  const { token, maxAge } = createSessionToken(user.id)
  res.cookie(COOKIE_NAME, token, { ...getCookieOptions(), maxAge })

  return res.status(200).json({
    success: true,
    data: { user: safeUser(user) },
  })
}

async function getCurrentUser(req, res) {
  return res.status(200).json({
    success: true,
    data: { user: safeUser(req.user) },
  })
}

async function updateCurrentUser(req, res) {
  const { name } = normalizeProfileUpdateInput(req.body)
  const user = await authService.updateUserName(req.user.id, name)

  return res.status(200).json({ success: true, data: { user } })
}

function logout(req, res) {
  res.clearCookie(COOKIE_NAME, getCookieOptions())
  return res.status(200).json({ success: true, message: 'You have been logged out.' })
}

module.exports = { register, login, getCurrentUser, updateCurrentUser, logout }
