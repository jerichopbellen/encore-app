const test = require('node:test')
const assert = require('node:assert/strict')
const { serializeReservation } = require('../../server/src/services/reservationService')

test('reservation serialization calculates line totals in cents and emits ISO dates', () => {
  const reservation = serializeReservation({
    id: 'reservation-id',
    status: 'pending',
    created_at: new Date('2030-01-01T10:00:00Z'),
    expires_at: new Date('2030-01-01T10:15:00Z'),
    reservation_items: [{
      id: 'item-id',
      ticket_type_id: 'ticket-id',
      quantity: 3,
      unit_price: { toFixed: () => '19.95' },
      ticket_types: {
        name: 'Floor',
        events: { id: 'event-id', title: 'Encore Live', venue: 'Test Hall', starts_at: new Date('2030-02-01T18:00:00Z') },
      },
    }],
  })

  assert.equal(reservation.total_amount, '59.85')
  assert.equal(reservation.items[0].line_total, '59.85')
  assert.equal(reservation.items[0].unit_price, '19.95')
  assert.equal(reservation.items[0].event.starts_at, '2030-02-01T18:00:00.000Z')
  assert.equal(reservation.expires_at, '2030-01-01T10:15:00.000Z')
})
