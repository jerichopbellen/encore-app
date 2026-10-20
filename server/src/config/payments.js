const PAYMENT_PROVIDERS = new Set(['simulated', 'stripe'])

// Stripe Checkout Sessions must stay open for at least 30 minutes. Thirty-five
// leaves room for a retried session creation to still be valid.
const SESSION_LIFETIME_MINUTES = 35
// The Encore hold always outlives the Stripe session by this grace period, so a
// payment confirmed while the session was open still has time to be fulfilled.
const HOLD_GRACE_MINUTES = 5
// Payment initiation may extend a hold, but never beyond this age.
const MAX_HOLD_MINUTES = 60

function normalizeProvider(value) {
  return String(value ?? '').trim().toLowerCase() || 'simulated'
}

// Read at request time (not cached) so the mode can never drift from the environment.
function getPaymentMode(env = process.env) {
  const provider = normalizeProvider(env.PAYMENT_PROVIDER)
  if (!PAYMENT_PROVIDERS.has(provider)) throw new Error('PAYMENT_PROVIDER must be one of: simulated, stripe.')
  return provider
}

function validatePaymentEnvironment(env = process.env) {
  const provider = getPaymentMode(env)
  if (provider !== 'stripe') return { provider }

  // Error messages deliberately never include the configured values.
  if (!env.STRIPE_SECRET_KEY || !/^(sk|rk)_test_\S+$/.test(env.STRIPE_SECRET_KEY)) {
    throw new Error('STRIPE_SECRET_KEY must be a Stripe test-mode secret key (sk_test_...) when PAYMENT_PROVIDER=stripe.')
  }
  if (!env.STRIPE_WEBHOOK_SECRET || !/^whsec_\S+$/.test(env.STRIPE_WEBHOOK_SECRET)) {
    throw new Error('STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret (whsec_...) when PAYMENT_PROVIDER=stripe.')
  }
  if (!env.FRONTEND_ORIGIN) {
    throw new Error('FRONTEND_ORIGIN is required when PAYMENT_PROVIDER=stripe so Stripe can return customers to Encore.')
  }
  let origin
  try {
    origin = new URL(env.FRONTEND_ORIGIN)
  } catch {
    throw new Error('FRONTEND_ORIGIN must be a valid origin when PAYMENT_PROVIDER=stripe.')
  }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== env.FRONTEND_ORIGIN) {
    throw new Error('FRONTEND_ORIGIN must be an origin with no path, query, or fragment when PAYMENT_PROVIDER=stripe.')
  }

  return { provider }
}

function getStripeConfig(env = process.env) {
  return {
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    frontendOrigin: env.FRONTEND_ORIGIN,
  }
}

module.exports = {
  getPaymentMode,
  validatePaymentEnvironment,
  getStripeConfig,
  SESSION_LIFETIME_MINUTES,
  HOLD_GRACE_MINUTES,
  MAX_HOLD_MINUTES,
}
