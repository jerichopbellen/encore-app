const AppError = require('../utils/AppError')
const { getPrismaClient } = require('../config/prisma')

const RESERVATION_HOLD_MINUTES = 15
const EXPIRY_BATCH_SIZE = 100

const reservationInclude = {
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
}

function priceToCents(price) {
  const [whole, fraction = ''] = price.toFixed(2).split('.')
  return BigInt(whole) * 100n + BigInt(fraction)
}

function centsToPrice(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
}

function serializeReservation(reservation) {
  let totalCents = 0n
  const items = reservation.reservation_items.map((item) => {
    const unitPriceCents = priceToCents(item.unit_price)
    const lineTotalCents = unitPriceCents * BigInt(item.quantity)
    totalCents += lineTotalCents

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
    id: reservation.id,
    status: reservation.status,
    created_at: reservation.created_at.toISOString(),
    expires_at: reservation.expires_at.toISOString(),
    items,
    total_amount: centsToPrice(totalCents),
  }
}

async function restoreInventoryForReservation(tx, reservationId) {
  const items = await tx.reservation_items.findMany({
    where: { reservation_id: reservationId },
    select: { ticket_type_id: true, quantity: true },
  })

  for (const item of items) {
    await tx.ticket_types.update({
      where: { id: item.ticket_type_id },
      data: { available_quantity: { increment: item.quantity } },
    })
  }
}

async function expirePendingReservations(tx, now) {
  let expiredCount = 0

  while (true) {
    const dueReservations = await tx.reservations.findMany({
      where: { status: 'pending', expires_at: { lte: now } },
      orderBy: { expires_at: 'asc' },
      take: EXPIRY_BATCH_SIZE,
      select: { id: true },
    })
    if (dueReservations.length === 0) break

    let claimedCount = 0
    for (const reservation of dueReservations) {
      const claimed = await tx.reservations.updateMany({
        where: { id: reservation.id, status: 'pending', expires_at: { lte: now } },
        data: { status: 'expired' },
      })
      if (claimed.count === 0) continue

      claimedCount += 1
      expiredCount += 1
      await restoreInventoryForReservation(tx, reservation.id)
    }

    // Another request may have claimed the same batch while this transaction waited.
    if (dueReservations.length < EXPIRY_BATCH_SIZE || claimedCount === 0) break
  }

  return expiredCount
}

async function releaseExpiredReservations() {
  const prisma = await getPrismaClient()
  const now = new Date()
  return prisma.$transaction((tx) => expirePendingReservations(tx, now))
}

async function createReservation(userId, { event_id, ticket_type_id, quantity }) {
  const prisma = await getPrismaClient()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + RESERVATION_HOLD_MINUTES * 60 * 1000)

  // Commit expiry cleanup separately so a rejected reservation cannot roll it back.
  await releaseExpiredReservations()

  const reservation = await prisma.$transaction(async (tx) => {
    const event = await tx.events.findFirst({
      where: { id: event_id, status: 'published' },
      select: { id: true },
    })
    if (!event) throw new AppError('Event not found.', 404)

    const ticketType = await tx.ticket_types.findFirst({
      where: { id: ticket_type_id, event_id },
      select: { price: true },
    })
    if (!ticketType) throw new AppError('That ticket type is not available for this event.', 400)

    // PostgreSQL applies this condition and decrement atomically, including when requests race.
    const inventory = await tx.ticket_types.updateMany({
      where: { id: ticket_type_id, event_id, available_quantity: { gte: quantity } },
      data: { available_quantity: { decrement: quantity } },
    })
    if (inventory.count === 0) {
      throw new AppError('There are not enough tickets available for that quantity.', 409)
    }

    return tx.reservations.create({
      data: {
        user_id: userId,
        status: 'pending',
        expires_at: expiresAt,
        reservation_items: {
          create: { ticket_type_id, quantity, unit_price: ticketType.price },
        },
      },
      include: reservationInclude,
    })
  })

  return serializeReservation(reservation)
}

async function listReservations(userId) {
  await releaseExpiredReservations()
  const prisma = await getPrismaClient()
  const reservations = await prisma.reservations.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    include: reservationInclude,
  })
  return reservations.map(serializeReservation)
}

async function getReservationForUser(userId, reservationId) {
  await releaseExpiredReservations()
  const prisma = await getPrismaClient()
  const reservation = await prisma.reservations.findFirst({
    where: { id: reservationId, user_id: userId },
    include: reservationInclude,
  })
  return reservation ? serializeReservation(reservation) : null
}

async function cancelReservation(userId, reservationId) {
  const prisma = await getPrismaClient()
  const now = new Date()

  const result = await prisma.$transaction(async (tx) => {
    await expirePendingReservations(tx, now)

    const reservation = await tx.reservations.findFirst({
      where: { id: reservationId, user_id: userId },
      select: { id: true, status: true, expires_at: true },
    })
    if (!reservation) return { outcome: 'not-found', reservation: null }
    if (reservation.status !== 'pending') {
      return { outcome: reservation.status === 'expired' ? 'expired' : 'not-pending' }
    }

    const cancelled = await tx.reservations.updateMany({
      where: { id: reservationId, user_id: userId, status: 'pending', expires_at: { gt: now } },
      data: { status: 'cancelled' },
    })
    if (cancelled.count === 0) {
      await expirePendingReservations(tx, new Date())
      const current = await tx.reservations.findFirst({
        where: { id: reservationId, user_id: userId },
        select: { status: true },
      })
      return { outcome: current?.status === 'expired' ? 'expired' : 'not-pending' }
    }

    await restoreInventoryForReservation(tx, reservationId)
    const updated = await tx.reservations.findUnique({
      where: { id: reservationId },
      include: reservationInclude,
    })
    return { outcome: 'cancelled', reservation: serializeReservation(updated) }
  })

  return result
}

module.exports = {
  createReservation,
  listReservations,
  getReservationForUser,
  cancelReservation,
  releaseExpiredReservations,
  serializeReservation,
}
