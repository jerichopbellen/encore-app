const express = require('express')
const reservationController = require('../controllers/reservationController')

const router = express.Router()

// These routes are not protected yet; authentication is not implemented.
router.post('/', reservationController.createReservation)
router.get('/:reservationId', reservationController.getReservation)
router.post('/:reservationId/cancel', reservationController.cancelReservation)
router.post('/:reservationId/checkout', reservationController.checkoutReservation)

module.exports = router
