const express = require('express')
const bookingController = require('../controllers/bookingController')

const router = express.Router()

// These routes are not protected yet; authentication is not implemented.
router.get('/', bookingController.listBookings)
router.get('/:bookingId', bookingController.getBooking)

module.exports = router
