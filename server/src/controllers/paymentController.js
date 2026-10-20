const AppError = require('../utils/AppError')
const paymentService = require('../services/paymentService')
const stripeGateway = require('../services/stripeGateway')
const { getPaymentMode } = require('../config/payments')
const { validateReservationId } = require('../validators/reservationValidator')

async function getPaymentConfig(req, res) {
  return res.status(200).json({ success: true, data: { provider: getPaymentMode() } })
}

async function startPayment(req, res) {
  validateReservationId(req.params.reservationId)
  const { payment, created } = await paymentService.startPayment(req.user.id, req.params.reservationId)
  return res.status(created ? 201 : 200).json({ success: true, data: { payment } })
}

async function cancelPayment(req, res) {
  validateReservationId(req.params.reservationId)
  const { outcome, payment } = await paymentService.cancelPayment(req.user.id, req.params.reservationId)
  return res.status(200).json({ success: true, data: { outcome, payment } })
}

async function getLatestPayment(req, res) {
  validateReservationId(req.params.reservationId)
  const result = await paymentService.getLatestPayment(req.user.id, req.params.reservationId)
  if (!result.found) throw new AppError('Reservation not found.', 404)
  return res.status(200).json({ success: true, data: { payment: result.payment } })
}

// Mounted with express.raw() so `req.body` is the exact byte payload Stripe signed.
async function stripeWebhook(req, res) {
  paymentService.assertStripeMode()

  let event
  try {
    event = stripeGateway.constructEvent(req.body, req.get('Stripe-Signature'))
  } catch {
    // Unsigned, tampered, stale, or malformed: nothing is read or stored.
    return res.status(400).json({ success: false, message: 'The Stripe signature could not be verified.' })
  }

  // Encore only supports Stripe test mode. A live-mode event (for example from a live
  // webhook endpoint secret) is refused before anything is read from or written to the database.
  if (event.livemode !== false) {
    return res.status(400).json({ success: false, message: 'Live-mode Stripe events are not accepted.' })
  }

  // A thrown error rolls the whole transaction back and surfaces as a 500, so Stripe retries.
  await paymentService.processStripeEvent(event)
  return res.status(200).json({ success: true, received: true })
}

module.exports = { getPaymentConfig, startPayment, cancelPayment, getLatestPayment, stripeWebhook }
