const test = require('node:test')
const assert = require('node:assert/strict')
const {
  normalizeCreateTicketTypeInput,
  normalizeUpdateTicketTypeInput,
  validateTicketTypeId,
} = require('../../server/src/validators/ticketTypeValidator')
const { calculateAvailableQuantity } = require('../../server/src/utils/ticketInventoryRules')

const eventId = 'c397f634-687f-45a2-a5c6-d4fac5a38a55'
const ticketTypeId = 'b1000000-0000-4000-8000-000000000001'

test('ticket type creation trims names, normalizes money, and allows a zero capacity', () => {
  assert.deepEqual(normalizeCreateTicketTypeInput(eventId, {
    name: '  Balcony  ', price: '125.5', total_quantity: 0,
  }), { name: 'Balcony', price: '125.50', total_quantity: 0 })
})

test('ticket type validation rejects malformed IDs, unknown fields, and invalid prices or quantities', () => {
  validateTicketTypeId(ticketTypeId)
  assert.throws(() => validateTicketTypeId('not-a-uuid'), (error) => error.statusCode === 400)
  for (const input of [
    { name: ' ', price: '10.00', total_quantity: 1 },
    { name: 'Balcony', price: '0', total_quantity: 1 },
    { name: 'Balcony', price: '1.001', total_quantity: 1 },
    { name: 'Balcony', price: 'Infinity', total_quantity: 1 },
    { name: 'Balcony', price: '1e3', total_quantity: 1 },
    { name: 'Balcony', price: '10.00', total_quantity: -1 },
    { name: 'Balcony', price: '10.00', total_quantity: 1.5 },
    { name: 'Balcony', price: '10.00', total_quantity: 1, event_id: eventId },
  ]) {
    assert.throws(() => normalizeCreateTicketTypeInput(eventId, input), (error) => error.statusCode === 400)
  }
})

test('ticket type updates allow only editable fields and validate partial input', () => {
  assert.deepEqual(normalizeUpdateTicketTypeInput(eventId, ticketTypeId, { price: 25 }), { price: '25.00' })
  assert.deepEqual(normalizeUpdateTicketTypeInput(eventId, ticketTypeId, { total_quantity: 0 }), { total_quantity: 0 })
  assert.throws(() => normalizeUpdateTicketTypeInput(eventId, ticketTypeId, {}), (error) => error.statusCode === 400)
  assert.throws(() => normalizeUpdateTicketTypeInput(eventId, ticketTypeId, { event_id: eventId }), (error) => error.statusCode === 400)
})

test('capacity decisions protect commitments and calculate remaining inventory', () => {
  assert.equal(calculateAvailableQuantity(12, 7n), 5)
  assert.equal(calculateAvailableQuantity(7, 7n), 0)
  assert.equal(calculateAvailableQuantity(6, 7n), null)
})
