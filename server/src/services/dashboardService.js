const { getPrismaClient } = require('../config/prisma')

function countForStatus(groups, status) {
  return groups.find((group) => group.status === status)?._count._all ?? 0
}

function sumGroupCounts(groups) {
  return groups.reduce((total, group) => total + group._count._all, 0)
}

function buildDashboardOverview({ eventGroups, upcomingEventCount, inventory, reservationGroups, expiredPendingCount, confirmedBookingCount, upcomingEvents }) {
  const totalEventCount = sumGroupCounts(eventGroups)
  const storedPendingCount = countForStatus(reservationGroups, 'pending')

  return {
    event_counts: {
      total: totalEventCount,
      published: countForStatus(eventGroups, 'published'),
      draft: countForStatus(eventGroups, 'draft'),
      // Events have only a start time, so every event not yet started is upcoming and the rest are past.
      upcoming: upcomingEventCount,
      past: Math.max(0, totalEventCount - upcomingEventCount),
    },
    ticket_inventory: {
      ticket_type_count: inventory._count._all,
      total_capacity: inventory._sum.total_quantity ?? 0,
      available_quantity: inventory._sum.available_quantity ?? 0,
    },
    reservation_counts: {
      pending: Math.max(0, storedPendingCount - expiredPendingCount),
      cancelled: countForStatus(reservationGroups, 'cancelled'),
      expired: countForStatus(reservationGroups, 'expired'),
      confirmed: countForStatus(reservationGroups, 'confirmed'),
      pending_expired: expiredPendingCount,
      other: reservationGroups
        .filter((group) => !['pending', 'cancelled', 'expired', 'confirmed'].includes(group.status))
        .reduce((total, group) => total + group._count._all, 0),
      total: sumGroupCounts(reservationGroups),
    },
    confirmed_booking_count: confirmedBookingCount,
    upcoming_events: upcomingEvents.map((event) => ({
      id: event.id,
      title: event.title,
      venue: event.venue,
      starts_at: event.starts_at.toISOString(),
    })),
  }
}

async function getDashboardOverview() {
  const prisma = await getPrismaClient()
  const now = new Date()

  // RepeatableRead gives all dashboard cards one consistent database snapshot.
  // This is deliberately read-only: expired holds are reported, not processed here.
  return prisma.$transaction(async (tx) => {
    const [eventGroups, upcomingEventCount, inventory, reservationGroups, expiredPendingCount, confirmedBookingCount, upcomingEvents] = await Promise.all([
      tx.events.groupBy({ by: ['status'], _count: { _all: true } }),
      tx.events.count({ where: { starts_at: { gt: now } } }),
      tx.ticket_types.aggregate({
        _count: { _all: true },
        _sum: { total_quantity: true, available_quantity: true },
      }),
      tx.reservations.groupBy({ by: ['status'], _count: { _all: true } }),
      tx.reservations.count({ where: { status: 'pending', expires_at: { lte: now } } }),
      tx.bookings.count({ where: { status: 'confirmed' } }),
      tx.events.findMany({
        where: { status: 'published', starts_at: { gt: now } },
        orderBy: { starts_at: 'asc' },
        take: 5,
        select: { id: true, title: true, venue: true, starts_at: true },
      }),
    ])

    return buildDashboardOverview({
      eventGroups,
      upcomingEventCount,
      inventory,
      reservationGroups,
      expiredPendingCount,
      confirmedBookingCount,
      upcomingEvents,
    })
  }, { isolationLevel: 'RepeatableRead' })
}

module.exports = { getDashboardOverview, buildDashboardOverview }
