const AppError = require('../utils/AppError')

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeReservationInput(body = {}) {
  const { event_id, ticket_type_id, quantity } = body ?? {}

  if (typeof event_id !== 'string' || !UUID_PATTERN.test(event_id)) {
    throw new AppError('A valid event ID is required.', 400)
  }
  if (typeof ticket_type_id !== 'string' || !UUID_PATTERN.test(ticket_type_id)) {
    throw new AppError('A valid ticket type ID is required.', 400)
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new AppError('Quantity must be a positive whole number.', 400)
  }

  return { event_id, ticket_type_id, quantity }
}

function validateReservationId(reservationId) {
  if (!UUID_PATTERN.test(reservationId)) {
    throw new AppError('Reservation ID must be a valid UUID.', 400)
  }
}

module.exports = { normalizeReservationInput, validateReservationId }
