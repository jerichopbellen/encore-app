const Stripe = require('stripe')
const { getStripeConfig } = require('../config/payments')

// Every Stripe call goes through this module so tests can replace session
// creation without network access. Webhook signature verification is local
// cryptography and always uses the real library.
let cachedClient
let cachedKey
let testGateway

function getClient() {
  const { secretKey } = getStripeConfig()
  if (!cachedClient || cachedKey !== secretKey) {
    cachedClient = new Stripe(secretKey, { timeout: 15000, maxNetworkRetries: 1 })
    cachedKey = secretKey
  }
  return cachedClient
}

function createCheckoutSession(params, idempotencyKey) {
  if (testGateway) return testGateway.createCheckoutSession(params, idempotencyKey)
  return getClient().checkout.sessions.create(params, { idempotencyKey })
}

// Stripe only expires a session that is still `open`; anything else is an error response.
function expireCheckoutSession(sessionId) {
  if (testGateway) return testGateway.expireCheckoutSession(sessionId)
  return getClient().checkout.sessions.expire(sessionId)
}

function retrieveCheckoutSession(sessionId) {
  if (testGateway) return testGateway.retrieveCheckoutSession(sessionId)
  return getClient().checkout.sessions.retrieve(sessionId)
}

// `rawBody` must be the exact bytes Stripe sent; a re-serialized JSON body fails verification.
function constructEvent(rawBody, signature) {
  const { webhookSecret } = getStripeConfig()
  return getClient().webhooks.constructEvent(rawBody, signature, webhookSecret)
}

function setGatewayForTests(gateway) {
  testGateway = gateway
}

module.exports = {
  createCheckoutSession,
  expireCheckoutSession,
  retrieveCheckoutSession,
  constructEvent,
  setGatewayForTests,
}
