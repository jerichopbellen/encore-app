const AppError = require('../utils/AppError')
const { getPrismaClient } = require('../config/prisma')
const { releaseExpiredReservations } = require('./reservationService')
const { createHash } = require('node:crypto')
const { getPaymentMode } = require('../config/payments')

const CHECKOUT_OPERATION = 'checkout'

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

function checkoutRequestHash(reservationId) {
  // Reservation ID is the only meaningful checkout input; submitted amounts
  // are ignored and totals always come from saved reservation-item prices.
  return createHash('sha256').update(JSON.stringify({ reservation_id: reservationId })).digest('hex')
}

function getReplayResult(record, requestHash) {
  if (record.request_hash !== requestHash) {
    throw new AppError('This Idempotency-Key was already used for a different checkout request.', 409)
  }
  if (!record.response_status || !record.response_body) {
    // A committed incomplete row should not be produced by this transaction.
    throw new AppError('This checkout request cannot be replayed. Please use a new Idempotency-Key.', 409)
  }
  return { outcome: 'replayed', responseStatus: record.response_status, responseBody: record.response_body }
}

// Shared by simulated checkout and verified Stripe fulfilment so both paths
// keep the same event-lock and event-start invariants. Returns the new booking
// ID, or null when the event has already started (nothing is inserted).
async function insertBookingForReservation(tx, { reservationId, userId, totalCents }) {
  // Hold the event rows through checkout so an administrator changing an
  // event's start time cannot race the final booking write. A lock wait
  // returns the committed event version before the write-time cutoff.
  await tx.$queryRaw`/* encore-checkout-event-lock */
    SELECT event.id
    FROM events AS event
    WHERE EXISTS (
      SELECT 1
      FROM reservation_items AS item
      JOIN ticket_types AS ticket ON ticket.id = item.ticket_type_id
      WHERE item.reservation_id = ${reservationId}::uuid
        AND ticket.event_id = event.id
    )
    ORDER BY event.id
    FOR SHARE OF event`

  // This conditional insert is the authoritative cutoff check. It uses
  // PostgreSQL wall-clock time at the write, not the earlier Node check.
  const insertedBookings = await tx.$queryRaw`/* encore-checkout-cutoff-write */
    INSERT INTO bookings (reservation_id, user_id, status, total_amount)
    SELECT reservation.id, reservation.user_id, 'confirmed', ${centsToPrice(totalCents)}::numeric
    FROM reservations AS reservation
    WHERE reservation.id = ${reservationId}::uuid
      AND reservation.user_id = ${userId}::uuid
      AND NOT EXISTS (
        SELECT 1
        FROM reservation_items AS item
        JOIN ticket_types AS ticket ON ticket.id = item.ticket_type_id
        JOIN events AS event ON event.id = ticket.event_id
        WHERE item.reservation_id = reservation.id
          AND event.starts_at <= clock_timestamp()
      )
    RETURNING id`
  return insertedBookings.length === 0 ? null : insertedBookings[0].id
}

async function checkoutReservation(userId, reservationId, idempotencyKey) {
  // Simulated checkout must never bypass Stripe. This is the first statement,
  // before any database work, and applies to every caller of the service.
  if (getPaymentMode() === 'stripe') {
    throw new AppError('This reservation must be paid through Stripe Checkout.', 409)
  }

  const prisma = await getPrismaClient()
  const requestHash = checkoutRequestHash(reservationId)
  const keyWhere = {
    user_id_operation_idempotency_key: {
      user_id: userId,
      operation: CHECKOUT_OPERATION,
      idempotency_key: idempotencyKey,
    },
  }

  // A committed result is checked before expiry cleanup so a retry can recover
  // the original response even though its reservation is now confirmed.
  const existing = await prisma.idempotency_keys.findUnique({ where: keyWhere })
  if (existing) return getReplayResult(existing, requestHash)

  // Expiry cleanup is committed separately so it is not rolled back by a conflict.
  await releaseExpiredReservations()
  const now = new Date()

  try {
    return await prisma.$transaction(async (tx) => {
      const keyRecord = await tx.idempotency_keys.create({
        data: {
          user_id: userId,
          operation: CHECKOUT_OPERATION,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
        },
      })

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
        // Failed checkout outcomes are intentionally not cached. Deleting the
        // claim in this transaction means a corrected/retried request can proceed.
        await tx.idempotency_keys.delete({ where: { id: keyRecord.id } })
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

      const bookingId = await insertBookingForReservation(tx, { reservationId, userId, totalCents })
      if (!bookingId) {
        throw new AppError('This event has already started and is no longer available for checkout.', 409)
      }

      const booking = await tx.bookings.findUnique({
        where: { reservation_id: reservationId },
        include: bookingInclude,
      })

      const responseBody = { success: true, data: { booking: serializeBooking(booking) } }
      await tx.idempotency_keys.update({
        where: { id: keyRecord.id },
        data: { response_status: 201, response_body: responseBody },
      })

      return { outcome: 'created', responseStatus: 201, responseBody }
    })
  } catch (error) {
    // PostgreSQL's composite unique constraint makes concurrent claims wait for
    // the winner. After its commit, this request reads and replays that result.
    if (error.code === 'P2002') {
      const committedKey = await prisma.idempotency_keys.findUnique({ where: keyWhere })
      if (committedKey) return getReplayResult(committedKey, requestHash)
    }
    throw error
  }
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

module.exports = {
  checkoutReservation,
  insertBookingForReservation,
  listBookings,
  getBookingForUser,
  priceToCents,
  centsToPrice,
}
