const crypto = require('node:crypto')
const { rateLimit, ipKeyGenerator } = require('express-rate-limit')
const AppError = require('../utils/AppError')
const { logRateLimited } = require('../utils/structuredLogger')
const { BoundedMemoryStore } = require('./boundedMemoryStore')
const { getRateLimitConfig } = require('../config/rateLimit')

// Express-level (application layer) rate limiting. This is one of three layers; edge
// protection (DDoS/WAF) and the database's own constraints are separate and not provided here.
//
// Every limiter answers through next(AppError(..., 429)), so the response is the same
// { success: false, message } JSON that errorMiddleware produces for every other API error.
// express-rate-limit sets the Retry-After header (standardHeaders is enabled) before it
// calls the handler, so no limiter needs to set it by hand. Each 429 is also logged as a
// `rate_limited` event (limiter name, route template, status only).
//
// COUNTING MODEL. The library counts a request when it ARRIVES (so parallel requests are all
// counted before any finishes, and a burst can never admit more than the limit at once) and
// then, when the response finishes, gives the count back if requestWasSuccessful() says so.
// Every limiter below therefore states which responses stay counted. A 429 is ALWAYS given
// back, so a blocked request never uses up another slot or inflates a counter.

const EXEMPT_PATHS = new Set(['/api/health', '/api/ready', '/api/payments/stripe/webhook'])
const READ_METHODS = new Set(['GET', 'HEAD'])
const MAX_EMAIL_KEY_LENGTH = 255

const MESSAGES = {
  loginIp: 'Too many sign-in requests. Please wait a few minutes and try again.',
  loginFailure: 'Too many failed sign-in attempts. Please wait a few minutes and try again.',
  registration: 'Too many sign-up attempts. Please try again later.',
  reservation: 'You are reserving tickets too quickly. Please wait a few minutes and try again.',
  reservationCancel: 'Too many cancellation requests. Please wait a few minutes and try again.',
  reservationRead: 'Too many reservation requests. Please slow down and try again shortly.',
  paymentInitiation: 'Too many checkout attempts. Please wait a few minutes and try again.',
  paymentCancellation: 'Too many payment cancellations. Please wait a few minutes and try again.',
  posterMutation: 'Too many poster changes. Please wait a few minutes and try again.',
  generalRead: 'Too many requests. Please slow down and try again shortly.',
}

function hashKeyPart(value) {
  // A fixed-length digest keeps attacker-chosen values (emails) from inflating key sizes in memory.
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 32)
}

// Same normalization as normalizeLoginInput (trim + lower case), so "Ana@x.com" and
// " ana@X.com " share one counter. Returns null when the body has no usable email.
function normalizeEmailForRateLimit(body) {
  const email = body && typeof body === 'object' ? body.email : undefined
  if (typeof email !== 'string') return null
  const normalized = email.trim().toLowerCase().slice(0, MAX_EMAIL_KEY_LENGTH)
  return normalized || null
}

// Responses in `statuses` are given back; every other response stays counted. 429 is always given back.
function giveBack(statuses = []) {
  const givenBack = new Set([...statuses, 429])
  return { skipSuccessfulRequests: true, requestWasSuccessful: (req, res) => givenBack.has(res.statusCode) }
}

// Only responses in `statuses` stay counted; everything else, including 429, is given back.
function countOnly(statuses) {
  const counted = new Set(statuses)
  return { skipSuccessfulRequests: true, requestWasSuccessful: (req, res) => !counted.has(res.statusCode) }
}

function createRateLimiters(config = getRateLimitConfig(), { now } = {}) {
  const stores = []

  // The single place that chooses the storage backend. To share counters between
  // instances later, return a shared-store implementation here.
  function createStore() {
    const store = new BoundedMemoryStore({ maxKeys: config.maxKeys, ...(now ? { now } : {}) })
    stores.push(store)
    return store
  }

  const ipEnabled = config.ipLimitingEnabled
  const skipWithoutTrustedIp = () => !ipEnabled
  const ipKey = (req) => ipKeyGenerator(req.ip || 'unknown')
  const accountKey = (req) => {
    // Mounted after requireAuthentication. Failing loudly beats silently sharing one global bucket.
    if (!req.user?.id) throw new Error('Account rate limiter requires an authenticated user.')
    return `user:${req.user.id}`
  }

  function build({ name, limits, message, keyGenerator, ...extra }) {
    return rateLimit({
      windowMs: limits.windowMs,
      limit: limits.limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      store: createStore(),
      keyGenerator,
      handler: (req, res, next) => {
        logRateLimited(req, name)
        next(new AppError(message, 429))
      },
      ...extra,
    })
  }

  const limiters = {
    // All login requests per IP. Off unless NODE_ENV is development or test (never in production).
    // Counts every response except its own 429.
    loginIp: build({
      name: 'loginIp',
      limits: config.limits.loginIp,
      message: MESSAGES.loginIp,
      keyGenerator: ipKey,
      skip: skipWithoutTrustedIp,
      ...giveBack(),
    }),

    // Failed logins per (normalized email, IP). Keying on the IP too means an attacker
    // elsewhere cannot lock the real owner out: their failures fill their own counter only.
    // Only 401 responses count; a successful login, a validation 400, a 5xx or a 429 never does.
    // Unknown and registered emails count identically, so the 429 never reveals which exist.
    //
    // FALLBACK: while IP limiting is off (always in production) the key is the email alone and the
    // limit is the much more generous loginFailureNoIp (default 50 per hour). That is a weaker
    // safeguard than email-plus-IP: it slows sustained guessing but is not equivalent to it, and
    // anyone can consume the shared counter. It is the production login-failure limiter for as
    // long as IP limiting stays disabled.
    loginFailure: build({
      name: ipEnabled ? 'loginFailure' : 'loginFailureNoIp',
      limits: ipEnabled ? config.limits.loginFailure : config.limits.loginFailureNoIp,
      message: MESSAGES.loginFailure,
      keyGenerator: (req) => `login-failure:${hashKeyPart(normalizeEmailForRateLimit(req.body))}:${ipEnabled ? ipKey(req) : 'any'}`,
      skip: (req) => normalizeEmailForRateLimit(req.body) === null,
      ...countOnly([401]),
    }),

    // Registration costs a bcrypt hash. Validation failures (400) return before hashing and are
    // given back, so a person fixing a typo is not penalised; successes, duplicates and errors count.
    registration: build({
      name: 'registration',
      limits: config.limits.registration,
      message: MESSAGES.registration,
      keyGenerator: ipKey,
      skip: skipWithoutTrustedIp,
      ...giveBack([400]),
    }),

    // Reservation creation is protected by two account limiters that run in this order:
    //  1. reservationAttempt counts EVERY request that reaches the handler (201, 400, 404, 409, 5xx),
    //     because even rejected attempts run the global expiry sweep and database locks. Only its
    //     own 429 and a 429 from a later limiter are given back.
    //  2. reservationCreation counts only successful creations (201), which is what stops rapid
    //     create-and-cancel cycling.
    // A request blocked by either limiter is given back by both. The database lock and the
    // pending-hold cap remain the inventory protection; these limiters only bound request volume.
    reservationAttempt: build({
      name: 'reservationAttempt',
      limits: config.limits.reservationAttempt,
      message: MESSAGES.reservation,
      keyGenerator: accountKey,
      ...giveBack(),
    }),
    reservationCreation: build({
      name: 'reservationCreation',
      limits: config.limits.reservationCreation,
      message: MESSAGES.reservation,
      keyGenerator: accountKey,
      ...countOnly([201]),
    }),
    // Separate per-IP backstop for creation. Off without a trusted IP.
    reservationIp: build({
      name: 'reservationIp',
      limits: config.limits.reservationIp,
      message: MESSAGES.reservation,
      keyGenerator: ipKey,
      skip: skipWithoutTrustedIp,
      ...giveBack([400, 409]),
    }),

    // Cancelling a reservation runs the global expiry sweep before it even looks the reservation
    // up, so every attempt counts, including 400/404/409 errors. Only its own 429 is given back.
    reservationCancel: build({
      name: 'reservationCancel',
      limits: config.limits.reservationCancel,
      message: MESSAGES.reservationCancel,
      keyGenerator: accountKey,
      ...giveBack(),
    }),

    // Covers exactly the authenticated GET routes under /api/reservations, which each run the
    // expiry sweep: GET /, GET /:reservationId and GET /:reservationId/payments/latest. Writes are
    // skipped so creation, cancellation, checkout and payments are never double counted here.
    reservationRead: build({
      name: 'reservationRead',
      limits: config.limits.reservationRead,
      message: MESSAGES.reservationRead,
      keyGenerator: accountKey,
      skip: (req) => !READ_METHODS.has(req.method),
      ...giveBack(),
    }),

    // One bucket per account shared by POST /:id/checkout and POST /:id/payments. Only
    // validation errors (400) are given back; an Idempotency-Key replay counts like any other
    // request, so the limit leaves headroom for network-error retries.
    paymentInitiation: build({
      name: 'paymentInitiation',
      limits: config.limits.paymentInitiation,
      message: MESSAGES.paymentInitiation,
      keyGenerator: accountKey,
      ...giveBack([400]),
    }),

    // Separate bucket so a customer who exhausted payment initiation can still cancel
    // (cancelling releases a hold, the safe direction), but still bounded because stripe-mode
    // cancellation calls Stripe.
    paymentCancellation: build({
      name: 'paymentCancellation',
      limits: config.limits.paymentCancellation,
      message: MESSAGES.paymentCancellation,
      keyGenerator: accountKey,
      ...giveBack([400]),
    }),

    // Cloudinary poster upload and removal (admin only), one shared bucket per admin account.
    // Mounted before the body reader so a limited upload is never read. Every attempt counts.
    posterMutation: build({
      name: 'posterMutation',
      limits: config.limits.posterMutation,
      message: MESSAGES.posterMutation,
      keyGenerator: accountKey,
      ...giveBack(),
    }),

    // Loose baseline for GET/HEAD only. Health, readiness and the Stripe webhook are exempt.
    generalRead: build({
      name: 'generalRead',
      limits: config.limits.generalRead,
      message: MESSAGES.generalRead,
      keyGenerator: ipKey,
      skip: (req) => !ipEnabled
        || !READ_METHODS.has(req.method)
        || EXEMPT_PATHS.has(`${req.baseUrl}${req.path}`),
      ...giveBack(),
    }),
  }

  return {
    ...limiters,
    stores,
    resetAll: async () => { await Promise.all(stores.map((store) => store.resetAll())) },
    shutdown: () => { stores.forEach((store) => store.shutdown()) },
  }
}

// Applies the verified proxy hop count. null (unverified) and 0 leave Express's default of
// trusting no proxy. Only a whole number of hops is ever set, never `true`, and nothing
// parses X-Forwarded-For by hand: Express resolves req.ip, counting hops from the right.
function configureTrustProxy(app, trustProxyHops) {
  if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) app.set('trust proxy', trustProxyHops)
}

// Process-wide limiters used by the real routes, built from the environment at load time.
const rateLimiters = createRateLimiters()

module.exports = {
  rateLimiters,
  createRateLimiters,
  configureTrustProxy,
  normalizeEmailForRateLimit,
  EXEMPT_PATHS,
}
