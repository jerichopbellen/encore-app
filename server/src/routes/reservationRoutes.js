const express = require('express')
const reservationController = require('../controllers/reservationController')
const paymentController = require('../controllers/paymentController')
const { requireAuthentication } = require('../middleware/authMiddleware')
const { rateLimiters } = require('../middleware/rateLimiters')

const router = express.Router()

router.use(requireAuthentication)

// Account limiters run after requireAuthentication so req.user.id is available.
// reservationRead only acts on GET requests: GET /, GET /:reservationId and
// GET /:reservationId/payments/latest, all of which run the expired-reservation sweep.
// Creation, cancellation, checkout and payments have their own limiters and are not counted here.
router.use(rateLimiters.reservationRead)

router.post('/', rateLimiters.reservationAttempt, rateLimiters.reservationCreation, rateLimiters.reservationIp, reservationController.createReservation)
router.get('/', reservationController.listReservations)
router.get('/:reservationId', reservationController.getReservation)
router.post('/:reservationId/cancel', rateLimiters.reservationCancel, reservationController.cancelReservation)
router.post('/:reservationId/checkout', rateLimiters.paymentInitiation, reservationController.checkoutReservation)
router.post('/:reservationId/payments', rateLimiters.paymentInitiation, paymentController.startPayment)
router.post('/:reservationId/payments/cancel', rateLimiters.paymentCancellation, paymentController.cancelPayment)
router.get('/:reservationId/payments/latest', paymentController.getLatestPayment)

module.exports = router
