const AppError = require('../utils/AppError')
const { getPrismaClient } = require('../config/prisma')
const { releaseExpiredReservations } = require('./reservationService')

const bookingInclude = {
  reservations: {
    select: {
      reservation_items: {
        orderBy: { ticket_type_id: 'asc' },
        select: {
          id: true,
          ticket_type_id: true,
          quantity: true,
          unit_price: true,
          ticket_types: {
            select: {
              name: true,
              events: { select: { id: true, title: true, venue: true, starts_at: true } },
            },
          },
        },
      },
    },
  },
}

function priceToCents(price) {
  const [whole, fraction = ''] = price.toFixed(2).split('.')
  return BigInt(whole) * 100n + BigInt(fraction)
}

function centsToPrice(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
}

function serializeBooking(booking) {
  const items = booking.reservations.reservation_items.map((item) => {
    const unitPriceCents = priceToCents(item.unit_price)
    const lineTotalCents = unitPriceCents * BigInt(item.quantity)
    return {
      id: item.id,
      ticket_type_id: item.ticket_type_id,
      ticket_name: item.ticket_types.name,
      event: {
        id: item.ticket_types.events.id,
        title: item.ticket_types.events.title,
        venue: item.ticket_types.events.venue,
        starts_at: item.ticket_types.events.starts_at.toISOString(),
      },
      quantity: item.quantity,
      unit_price: centsToPrice(unitPriceCents),
      line_total: centsToPrice(lineTotalCents),
    }
  })

  return {
    id: booking.id,
    status: booking.status,
    created_at: booking.created_at.toISOString(),
    // The booking's saved total is the purchase record; item values are details.
    total_amount: booking.total_amount.toFixed(2),
    items,
  }
}

async function checkoutReservation(userId, reservationId) {
  const prisma = await getPrismaClient()
  // Expiry cleanup is committed separately so it is not rolled back by a conflict.
  await releaseExpiredReservations()
  const now = new Date()

  return prisma.$transaction(async (tx) => {
    // Only one concurrent request can change this still-active hold from pending.
    const claimed = await tx.reservations.updateMany({
      where: { id: reservationId, user_id: userId, status: 'pending', expires_at: { gt: now } },
      data: { status: 'confirmed' },
    })

    if (claimed.count === 0) {
      const reservation = await tx.reservations.findFirst({
        where: { id: reservationId, user_id: userId },
        select: { id: true },
      })
      return { outcome: reservation ? 'not-pending' : 'not-found' }
    }

    const reservation = await tx.reservations.findUnique({
      where: { id: reservationId },
      include: { reservation_items: bookingInclude.reservations.select.reservation_items },
    })
    if (reservation.reservation_items.length === 0) {
      throw new AppError('This reservation has no tickets to book.', 409)
    }

    const totalCents = reservation.reservation_items.reduce(
      (sum, item) => sum + priceToCents(item.unit_price) * BigInt(item.quantity),
      0n,
    )
    const booking = await tx.bookings.create({
      data: {
        reservation_id: reservationId,
        user_id: userId,
        status: 'confirmed',
        total_amount: centsToPrice(totalCents),
      },
      include: bookingInclude,
    })

    return { outcome: 'created', booking: serializeBooking(booking) }
  })
}

async function listBookings(userId) {
  const prisma = await getPrismaClient()
  const bookings = await prisma.bookings.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    include: bookingInclude,
  })
  return bookings.map(serializeBooking)
}

async function getBookingForUser(userId, bookingId) {
  const prisma = await getPrismaClient()
  const booking = await prisma.bookings.findFirst({
    where: { id: bookingId, user_id: userId },
    include: bookingInclude,
  })
  return booking ? serializeBooking(booking) : null
}

module.exports = { checkoutReservation, listBookings, getBookingForUser }
