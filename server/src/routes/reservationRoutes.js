const express = require('express')
const reservationController = require('../controllers/reservationController')
const paymentController = require('../controllers/paymentController')
const { requireAuthentication } = require('../middleware/authMiddleware')

const router = express.Router()

router.use(requireAuthentication)

router.post('/', reservationController.createReservation)
router.get('/', reservationController.listReservations)
router.get('/:reservationId', reservationController.getReservation)
router.post('/:reservationId/cancel', reservationController.cancelReservation)
router.post('/:reservationId/checkout', reservationController.checkoutReservation)
router.post('/:reservationId/payments', paymentController.startPayment)
router.post('/:reservationId/payments/cancel', paymentController.cancelPayment)
router.get('/:reservationId/payments/latest', paymentController.getLatestPayment)

module.exports = router
