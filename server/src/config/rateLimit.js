const { parseTrustProxyHops } = require('./environment')

// Initial PROPOSED limits. They are tuning values, not product requirements; every
// one can be overridden with RATE_LIMIT_<NAME>_MAX and RATE_LIMIT_<NAME>_WINDOW_MINUTES.
const LIMIT_DEFINITIONS = {
  // Every login request from one IP (successful or not).
  loginIp: { envName: 'LOGIN_IP', limit: 20, windowMinutes: 15 },
  // Failed logins for one normalized email from one IP.
  loginFailure: { envName: 'LOGIN_FAILURE', limit: 5, windowMinutes: 15 },
  // TEMPORARY, WEAKER fallback used only while no trusted client IP exists: failed logins for
  // one normalized email from anyone. Deliberately generous so it cannot cheaply lock an
  // account out; it is NOT equivalent to the email-plus-IP limit above.
  loginFailureNoIp: { envName: 'LOGIN_FAILURE_NO_IP', limit: 50, windowMinutes: 60 },
  // Registration attempts that reached the password hashing step, per IP.
  registration: { envName: 'REGISTRATION', limit: 5, windowMinutes: 60 },
  // Successful reservation creations (201) per authenticated account.
  reservationCreation: { envName: 'RESERVATION_CREATION', limit: 10, windowMinutes: 10 },
  // Every reservation attempt that reaches the creation handler (any status except our own 429).
  reservationAttempt: { envName: 'RESERVATION_ATTEMPT', limit: 60, windowMinutes: 10 },
  // Secondary reservation backstop per IP; looser, because several people may share an IP.
  reservationIp: { envName: 'RESERVATION_IP', limit: 30, windowMinutes: 10 },
  // Reservation cancellation per account; every attempt counts, including errors.
  reservationCancel: { envName: 'RESERVATION_CANCEL', limit: 30, windowMinutes: 10 },
  // Authenticated reservation reads (GET under /api/reservations) per account.
  reservationRead: { envName: 'RESERVATION_READ', limit: 200, windowMinutes: 10 },
  // Checkout and payment initiation per authenticated account (one shared bucket).
  paymentInitiation: { envName: 'PAYMENT_INITIATION', limit: 10, windowMinutes: 10 },
  // Payment cancellation per authenticated account, deliberately a separate bucket.
  paymentCancellation: { envName: 'PAYMENT_CANCELLATION', limit: 20, windowMinutes: 10 },
  // Cloudinary poster upload and removal per admin account (one shared bucket).
  posterMutation: { envName: 'POSTER_MUTATION', limit: 20, windowMinutes: 10 },
  // General read requests (GET/HEAD) per IP.
  generalRead: { envName: 'GENERAL_READ', limit: 300, windowMinutes: 15 },
}

// The only values of NODE_ENV for which the IP-keyed limiters run (exact, case-sensitive match).
const IP_LIMITING_ENVIRONMENTS = new Set(['development', 'test'])

const DEFAULT_MAX_KEYS = 10000
const MAX_LIMIT = 100000
const MAX_WINDOW_MINUTES = 24 * 60
const MAX_KEYS_CEILING = 1000000

function parseBoundedInteger(value, variableName, { min, max, fallback }) {
  if (value === undefined || value === '') return fallback
  if (!/^\d+$/.test(String(value).trim())) {
    throw new Error(`${variableName} must be a whole number between ${min} and ${max}.`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${variableName} must be a whole number between ${min} and ${max}.`)
  }
  return parsed
}

// Builds the rate-limit configuration from the environment. Invalid values throw
// (with messages that never echo the configured value), so a typo fails startup
// instead of silently weakening or over-tightening a limit.
function getRateLimitConfig(env = process.env) {
  const trustProxyHops = parseTrustProxyHops(env.TRUST_PROXY_HOPS, { production: env.NODE_ENV === 'production' })

  const limits = {}
  for (const [name, definition] of Object.entries(LIMIT_DEFINITIONS)) {
    const prefix = `RATE_LIMIT_${definition.envName}`
    const limit = parseBoundedInteger(env[`${prefix}_MAX`], `${prefix}_MAX`, {
      min: 1, max: MAX_LIMIT, fallback: definition.limit,
    })
    const windowMinutes = parseBoundedInteger(env[`${prefix}_WINDOW_MINUTES`], `${prefix}_WINDOW_MINUTES`, {
      min: 1, max: MAX_WINDOW_MINUTES, fallback: definition.windowMinutes,
    })
    limits[name] = { limit, windowMs: windowMinutes * 60 * 1000 }
  }

  const maxKeys = parseBoundedInteger(env.RATE_LIMIT_MAX_KEYS, 'RATE_LIMIT_MAX_KEYS', {
    min: 100, max: MAX_KEYS_CEILING, fallback: DEFAULT_MAX_KEYS,
  })

  // IP-based limiting is an explicit opt-in by environment, never inferred from "not production".
  // The request paths of the current Vercel-to-Render architecture have different proxy chains, so
  // no TRUST_PROXY_HOPS value identifies clients safely there (see DEPLOYMENT.md). The IP-keyed
  // limiters therefore run ONLY when NODE_ENV is exactly "development" or "test", where no proxy
  // sits in front of Express and the socket address is the client address. Production, an unset
  // NODE_ENV and any unexpected value (a typo, "staging") all leave them off, so a misconfiguration
  // can never put every visitor into one shared bucket. Account-keyed limiters are unaffected.
  const ipLimitingEnabled = IP_LIMITING_ENVIRONMENTS.has(env.NODE_ENV)

  // TRUST_PROXY_HOPS is still parsed and validated (a malformed value fails startup), but it only
  // takes effect where IP limiting is enabled. Everywhere else it is ignored.
  const effectiveTrustProxyHops = ipLimitingEnabled ? trustProxyHops : null

  return { trustProxyHops, effectiveTrustProxyHops, ipLimitingEnabled, limits, maxKeys }
}

module.exports = { LIMIT_DEFINITIONS, DEFAULT_MAX_KEYS, getRateLimitConfig }
