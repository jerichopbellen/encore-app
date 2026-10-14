const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeReservationInput, validateReservationId, validateBookingId } = require('../../server/src/validators/reservationValidator')

const eventId = 'a1000000-0000-4000-8000-000000000001'
const ticketTypeId = 'b1000000-0000-4000-8000-000000000001'

test('reservation input accepts UUIDs and positive whole quantities', () => {
  assert.deepEqual(normalizeReservationInput({ event_id: eventId, ticket_type_id: ticketTypeId, quantity: 3 }), {
    event_id: eventId,
    ticket_type_id: ticketTypeId,
    quantity: 3,
  })
})

test('reservation input rejects invalid identifiers and quantities', () => {
  for (const input of [
    { event_id: 'bad', ticket_type_id: ticketTypeId, quantity: 1 },
    { event_id: eventId, ticket_type_id: 'bad', quantity: 1 },
    { event_id: eventId, ticket_type_id: ticketTypeId, quantity: 0 },
    { event_id: eventId, ticket_type_id: ticketTypeId, quantity: -1 },
    { event_id: eventId, ticket_type_id: ticketTypeId, quantity: 1.5 },
    { event_id: eventId, ticket_type_id: ticketTypeId, quantity: '2' },
  ]) {
    assert.throws(() => normalizeReservationInput(input), (error) => error.statusCode === 400)
  }
})

test('reservation and booking route identifiers must be UUIDs', () => {
  assert.doesNotThrow(() => validateReservationId(eventId))
  assert.doesNotThrow(() => validateBookingId(eventId))
  assert.throws(() => validateReservationId('bad'), (error) => error.statusCode === 400)
  assert.throws(() => validateBookingId('bad'), (error) => error.statusCode === 400)
})
