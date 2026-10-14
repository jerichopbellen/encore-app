const AppError = require('../utils/AppError')
const reservationService = require('../services/reservationService')
const bookingService = require('../services/bookingService')
const {
  normalizeReservationInput,
  validateReservationId,
} = require('../validators/reservationValidator')

async function createReservation(req, res) {
  const input = normalizeReservationInput(req.body)
  const reservation = await reservationService.createReservation(req.user.id, input)
  return res.status(201).json({ success: true, data: { reservation } })
}

async function listReservations(req, res) {
  const reservations = await reservationService.listReservations(req.user.id)
  return res.status(200).json({ success: true, data: reservations })
}

async function getReservation(req, res) {
  validateReservationId(req.params.reservationId)
  const reservation = await reservationService.getReservationForUser(req.user.id, req.params.reservationId)
  if (!reservation) throw new AppError('Reservation not found.', 404)
  return res.status(200).json({ success: true, data: { reservation } })
}

async function cancelReservation(req, res) {
  validateReservationId(req.params.reservationId)
  const result = await reservationService.cancelReservation(req.user.id, req.params.reservationId)
  if (result.outcome === 'not-found') throw new AppError('Reservation not found.', 404)
  if (result.outcome === 'expired') throw new AppError('This reservation has expired.', 409)
  if (result.outcome === 'not-pending') {
    throw new AppError('Only a pending reservation can be cancelled.', 409)
  }
  return res.status(200).json({ success: true, data: { reservation: result.reservation } })
}

async function checkoutReservation(req, res) {
  validateReservationId(req.params.reservationId)
  const result = await bookingService.checkoutReservation(req.user.id, req.params.reservationId)
  if (result.outcome === 'not-found') throw new AppError('Reservation not found.', 404)
  if (result.outcome === 'not-pending') {
    throw new AppError('This reservation is no longer available for checkout.', 409)
  }
  return res.status(201).json({ success: true, data: { booking: result.booking } })
}

module.exports = { createReservation, listReservations, getReservation, cancelReservation, checkoutReservation }
