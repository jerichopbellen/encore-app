const { validatePaymentEnvironment } = require('./payments')

const DEFAULT_PORT = 5000
const DATABASE_PROTOCOLS = new Set(['postgres:', 'postgresql:'])
const SECURE_SSL_MODES = new Set(['require', 'verify-ca', 'verify-full'])
const COOKIE_SAME_SITE_VALUES = new Set(['lax', 'strict', 'none'])

function parsePort(value) {
  if (value === undefined || value === '') return DEFAULT_PORT
  if (!/^\d+$/.test(String(value))) throw new Error('PORT must be an integer between 1 and 65535.')
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.')
  }
  return port
}

function validateDatabaseUrl(value, variableName, { requireSsl = false } = {}) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL connection URL.`)
  }
  if (!DATABASE_PROTOCOLS.has(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) {
    throw new Error(`${variableName} must include a PostgreSQL protocol, host, and database name.`)
  }
  if (requireSsl && !SECURE_SSL_MODES.has(parsed.searchParams.get('sslmode'))) {
    throw new Error(`${variableName} must require TLS (for example, sslmode=require).`)
  }
}

function validateFrontendOrigin(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('FRONTEND_ORIGIN must be a valid HTTPS origin, such as https://encore.example.com.')
  }
  if (parsed.protocol !== 'https:' || parsed.origin !== value || parsed.username || parsed.password) {
    throw new Error('FRONTEND_ORIGIN must be an HTTPS origin with no path, credentials, query, or fragment.')
  }
}

function validateEnvironment(env = process.env) {
  const port = parsePort(env.PORT)
  // Fails startup on an unknown PAYMENT_PROVIDER or incomplete Stripe test configuration.
  validatePaymentEnvironment(env)
  const cookieSameSite = String(env.COOKIE_SAME_SITE || 'lax').toLowerCase()
  if (!COOKIE_SAME_SITE_VALUES.has(cookieSameSite)) {
    throw new Error('COOKIE_SAME_SITE must be one of: lax, strict, none.')
  }
  if (cookieSameSite === 'none' && env.NODE_ENV !== 'production') {
    throw new Error('COOKIE_SAME_SITE=none requires production HTTPS cookies.')
  }

  if (env.NODE_ENV === 'production') {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required in production.')
    validateDatabaseUrl(env.DATABASE_URL, 'DATABASE_URL', { requireSsl: true })

    if (!env.JWT_SECRET || Buffer.byteLength(env.JWT_SECRET, 'utf8') < 32 || /replace|placeholder|change.me|example/i.test(env.JWT_SECRET)) {
      throw new Error('JWT_SECRET must be a non-placeholder secret of at least 32 bytes in production.')
    }

    if (!env.FRONTEND_ORIGIN) throw new Error('FRONTEND_ORIGIN is required in production.')
    validateFrontendOrigin(env.FRONTEND_ORIGIN)

    if (env.DIRECT_DATABASE_URL) {
      validateDatabaseUrl(env.DIRECT_DATABASE_URL, 'DIRECT_DATABASE_URL', { requireSsl: true })
    }
  }

  return { port, host: '0.0.0.0', cookieSameSite }
}

module.exports = { validateEnvironment, parsePort, validateDatabaseUrl, validateFrontendOrigin }
