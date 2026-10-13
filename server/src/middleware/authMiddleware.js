const jwt = require('jsonwebtoken')
const AppError = require('../utils/AppError')
const { findSafeUserById } = require('../services/authService')

const COOKIE_NAME = 'encore_session'

async function requireAuthentication(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME]
  if (!token) return next(new AppError('Authentication is required.', 401))

  const secret = process.env.JWT_SECRET
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    return next(new Error('JWT_SECRET must be configured with at least 32 bytes.'))
  }

  let claims
  try {
    claims = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: 'encore-api',
      audience: 'encore-client',
    })
  } catch (error) {
    return next(new AppError('Authentication is invalid or has expired.', 401))
  }

  if (typeof claims.sub !== 'string') {
    return next(new AppError('Authentication is invalid or has expired.', 401))
  }

  // The database is the source of truth for the current profile and role.
  const user = await findSafeUserById(claims.sub)
  if (!user) return next(new AppError('Authentication is invalid or has expired.', 401))

  req.user = user
  return next()
}

module.exports = { requireAuthentication }
