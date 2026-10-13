const express = require('express')
const reservationController = require('../controllers/reservationController')
const { requireAuthentication } = require('../middleware/authMiddleware')

const router = express.Router()

router.use(requireAuthentication)

router.post('/', reservationController.createReservation)
router.get('/', reservationController.listReservations)
router.get('/:reservationId', reservationController.getReservation)
router.post('/:reservationId/cancel', reservationController.cancelReservation)
router.post('/:reservationId/checkout', reservationController.checkoutReservation)

module.exports = router
