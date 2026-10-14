const AppError = require('../utils/AppError')
const bookingService = require('../services/bookingService')
const { validateBookingId } = require('../validators/reservationValidator')

async function listBookings(req, res) {
  const bookings = await bookingService.listBookings(req.user.id)
  return res.status(200).json({ success: true, data: bookings })
}

async function getBooking(req, res) {
  validateBookingId(req.params.bookingId)
  const booking = await bookingService.getBookingForUser(req.user.id, req.params.bookingId)
  if (!booking) throw new AppError('Booking not found.', 404)
  return res.status(200).json({ success: true, data: { booking } })
}

module.exports = { listBookings, getBooking }
