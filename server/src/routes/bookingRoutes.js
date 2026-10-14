const express = require('express')
const bookingController = require('../controllers/bookingController')
const { requireAuthentication } = require('../middleware/authMiddleware')

const router = express.Router()

router.use(requireAuthentication)

router.get('/', bookingController.listBookings)
router.get('/:bookingId', bookingController.getBooking)

module.exports = router
