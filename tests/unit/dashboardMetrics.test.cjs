const test = require('node:test')
const assert = require('node:assert/strict')
const { buildDashboardOverview } = require('../../server/src/services/dashboardService')

const emptyInventory = {
  _count: { _all: 0 },
  _sum: { total_quantity: null, available_quantity: null },
}

test('dashboard metrics return zero values when the database has no records', () => {
  const dashboard = buildDashboardOverview({
    eventGroups: [],
    upcomingEventCount: 0,
    inventory: emptyInventory,
    reservationGroups: [],
    expiredPendingCount: 0,
    confirmedBookingCount: 0,
    upcomingEvents: [],
  })

  assert.deepEqual(dashboard, {
    event_counts: { total: 0, published: 0, draft: 0, upcoming: 0, past: 0 },
    ticket_inventory: { ticket_type_count: 0, total_capacity: 0, available_quantity: 0 },
    reservation_counts: {
      pending: 0, cancelled: 0, expired: 0, confirmed: 0,
      pending_expired: 0, other: 0, total: 0,
    },
    confirmed_booking_count: 0,
    upcoming_events: [],
  })
})

test('dashboard metrics separate active holds from expired holds awaiting processing', () => {
  const start = new Date('2032-05-01T18:00:00.000Z')
  const dashboard = buildDashboardOverview({
    eventGroups: [
      { status: 'published', _count: { _all: 2 } },
      { status: 'draft', _count: { _all: 1 } },
    ],
    upcomingEventCount: 2,
    inventory: { _count: { _all: 3 }, _sum: { total_quantity: 20, available_quantity: 12 } },
    reservationGroups: [
      { status: 'pending', _count: { _all: 3 } },
      { status: 'expired', _count: { _all: 2 } },
      { status: 'cancelled', _count: { _all: 1 } },
      { status: 'confirmed', _count: { _all: 4 } },
      { status: 'legacy-status', _count: { _all: 1 } },
    ],
    expiredPendingCount: 1,
    confirmedBookingCount: 3,
    upcomingEvents: [{ id: 'event-id', title: 'Show', venue: 'Hall', starts_at: start }],
  })

  assert.deepEqual(dashboard.event_counts, { total: 3, published: 2, draft: 1, upcoming: 2, past: 1 })
  assert.deepEqual(dashboard.ticket_inventory, { ticket_type_count: 3, total_capacity: 20, available_quantity: 12 })
  assert.deepEqual(dashboard.reservation_counts, {
    pending: 2, cancelled: 1, expired: 2, confirmed: 4,
    pending_expired: 1, other: 1, total: 11,
  })
  assert.equal(dashboard.confirmed_booking_count, 3)
  assert.deepEqual(dashboard.upcoming_events, [{
    id: 'event-id', title: 'Show', venue: 'Hall', starts_at: '2032-05-01T18:00:00.000Z',
  }])
})
