const AppError = require('../utils/AppError')
const { validateEventId } = require('./eventValidator')

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TICKET_TYPE_FIELDS = new Set(['name', 'price', 'total_quantity'])
const MAX_INT = 2_147_483_647

function validateTicketTypeId(ticketTypeId) {
  if (typeof ticketTypeId !== 'string' || !UUID_PATTERN.test(ticketTypeId)) {
    throw new AppError('Ticket type ID must be a valid UUID.', 400)
  }
}

function assertObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('A JSON object is required.', 400)
  }
}

function normalizeName(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('Ticket type name is required.', 400)
  }
  const name = value.trim()
  if (name.length > 100) throw new AppError('Ticket type name must be 100 characters or fewer.', 400)
  return name
}

function normalizePrice(value) {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value
  if (typeof text !== 'string' || !/^\d{1,10}(?:\.\d{1,2})?$/.test(text.trim())) {
    throw new AppError('Ticket price must be a positive amount with no more than two decimal places.', 400)
  }
  const [whole, fraction = ''] = text.trim().split('.')
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (cents <= 0n) throw new AppError('Ticket price must be greater than zero.', 400)
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
}

function normalizeTotalQuantity(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_INT) {
    throw new AppError('Total quantity must be a non-negative whole number.', 400)
  }
  return value
}

function rejectUnknownFields(body) {
  const unknownField = Object.keys(body).find((field) => !TICKET_TYPE_FIELDS.has(field))
  if (unknownField) throw new AppError(`Unsupported ticket type field: ${unknownField}.`, 400)
}

function normalizeCreateTicketTypeInput(eventId, body) {
  validateEventId(eventId)
  assertObject(body)
  rejectUnknownFields(body)
  if (!Object.hasOwn(body, 'name') || !Object.hasOwn(body, 'price') || !Object.hasOwn(body, 'total_quantity')) {
    throw new AppError('Ticket type name, price, and total quantity are required.', 400)
  }
  return {
    name: normalizeName(body.name),
    price: normalizePrice(body.price),
    total_quantity: normalizeTotalQuantity(body.total_quantity),
  }
}

function normalizeUpdateTicketTypeInput(eventId, ticketTypeId, body) {
  validateEventId(eventId)
  validateTicketTypeId(ticketTypeId)
  assertObject(body)
  rejectUnknownFields(body)
  if (Object.keys(body).length === 0) throw new AppError('Provide at least one ticket type field to update.', 400)

  const update = {}
  if (Object.hasOwn(body, 'name')) update.name = normalizeName(body.name)
  if (Object.hasOwn(body, 'price')) update.price = normalizePrice(body.price)
  if (Object.hasOwn(body, 'total_quantity')) update.total_quantity = normalizeTotalQuantity(body.total_quantity)
  return update
}

module.exports = {
  normalizeCreateTicketTypeInput,
  normalizeUpdateTicketTypeInput,
  validateTicketTypeId,
}
