const AppError = require('../utils/AppError')
const { getPrismaClient } = require('../config/prisma')
const { releaseExpiredReservations } = require('./reservationService')
const { lockTicketTypes, getCommittedQuantity } = require('./inventoryService')
const { calculateAvailableQuantity } = require('../utils/ticketInventoryRules')

const ticketTypeFields = {
  id: true,
  event_id: true,
  name: true,
  price: true,
  total_quantity: true,
  available_quantity: true,
}

function serializeTicketType(ticketType) {
  return { ...ticketType, price: ticketType.price.toFixed(2) }
}

function mapUniqueNameError(error) {
  if (error.code === 'P2002') {
    throw new AppError('A ticket type with this name already exists for the event.', 409)
  }
  throw error
}

async function listTicketTypes(eventId) {
  const prisma = await getPrismaClient()
  const event = await prisma.events.findUnique({ where: { id: eventId }, select: { id: true } })
  if (!event) return null
  const ticketTypes = await prisma.ticket_types.findMany({
    where: { event_id: eventId },
    orderBy: { name: 'asc' },
    select: ticketTypeFields,
  })
  return ticketTypes.map(serializeTicketType)
}

async function createTicketType(eventId, input) {
  const prisma = await getPrismaClient()
  const event = await prisma.events.findUnique({ where: { id: eventId }, select: { id: true } })
  if (!event) return null
  try {
    const created = await prisma.ticket_types.create({
      data: {
        event_id: eventId,
        name: input.name,
        price: input.price,
        total_quantity: input.total_quantity,
        available_quantity: input.total_quantity,
      },
      select: ticketTypeFields,
    })
    return serializeTicketType(created)
  } catch (error) {
    mapUniqueNameError(error)
  }
}

async function updateTicketType(eventId, ticketTypeId, input) {
  const prisma = await getPrismaClient()
  const changesCapacity = Object.hasOwn(input, 'total_quantity')
  if (!changesCapacity) {
    try {
      const updated = await prisma.ticket_types.updateMany({
        where: { id: ticketTypeId, event_id: eventId },
        data: input,
      })
      if (updated.count === 0) return null
      return serializeTicketType(await prisma.ticket_types.findUnique({
        where: { id: ticketTypeId },
        select: ticketTypeFields,
      }))
    } catch (error) {
      mapUniqueNameError(error)
    }
  }

  // A reservation may win the ticket row first (then its hold is counted), or
  // this edit may win first (then the reservation sees the new available count).
  await releaseExpiredReservations()
  const now = new Date()
  const outcome = await prisma.$transaction(async (tx) => {
    const expired = await tx.reservations.findMany({
      where: {
        status: 'pending',
        expires_at: { lte: now },
        reservation_items: { some: { ticket_type_id: ticketTypeId } },
      },
      select: { id: true },
    })
    const expiredIds = expired.map(({ id }) => id)
    const expiredItems = expiredIds.length
      ? await tx.reservation_items.findMany({
        where: { reservation_id: { in: expiredIds } },
        select: { ticket_type_id: true },
      })
      : []
    const affectedTypeIds = [...new Set([ticketTypeId, ...expiredItems.map((item) => item.ticket_type_id)])]
    await lockTicketTypes(tx, affectedTypeIds)

    const current = await tx.ticket_types.findFirst({
      where: { id: ticketTypeId, event_id: eventId },
      select: { id: true, total_quantity: true },
    })
    if (!current) return { outcome: 'not-found' }

    const claimedExpiredIds = []
    for (const reservationId of expiredIds) {
      const claimed = await tx.reservations.updateMany({
        where: { id: reservationId, status: 'pending', expires_at: { lte: now } },
        data: { status: 'expired' },
      })
      if (claimed.count) claimedExpiredIds.push(reservationId)
    }

    const affectedItems = claimedExpiredIds.length
      ? await tx.reservation_items.findMany({
        where: { reservation_id: { in: claimedExpiredIds } },
        select: { ticket_type_id: true },
      })
      : []
    const recalculatedTypeIds = [...new Set([ticketTypeId, ...affectedItems.map((item) => item.ticket_type_id)])]

    const committed = await getCommittedQuantity(tx, ticketTypeId, now)
    const availableQuantity = calculateAvailableQuantity(input.total_quantity, committed)
    if (availableQuantity === null) {
      // Commit expiry cleanup but keep the existing capacity unchanged.
      for (const affectedId of recalculatedTypeIds) {
        const type = await tx.ticket_types.findUnique({ where: { id: affectedId }, select: { total_quantity: true } })
        const held = await getCommittedQuantity(tx, affectedId, now)
        await tx.ticket_types.update({
          where: { id: affectedId },
          data: { available_quantity: type.total_quantity - Number(held) },
        })
      }
      return { outcome: 'capacity-conflict', committed: Number(committed) }
    }

    let updated
    try {
      updated = await tx.ticket_types.update({
        where: { id: ticketTypeId },
        data: {
          ...input,
          available_quantity: availableQuantity,
        },
        select: ticketTypeFields,
      })
    } catch (error) {
      mapUniqueNameError(error)
    }

    for (const affectedId of recalculatedTypeIds.filter((id) => id !== ticketTypeId)) {
      const type = await tx.ticket_types.findUnique({ where: { id: affectedId }, select: { total_quantity: true } })
      const held = await getCommittedQuantity(tx, affectedId, now)
      await tx.ticket_types.update({
        where: { id: affectedId },
        data: { available_quantity: type.total_quantity - Number(held) },
      })
    }

    return { outcome: 'updated', ticketType: updated }
  })

  if (outcome.outcome === 'not-found') return null
  if (outcome.outcome === 'capacity-conflict') {
    throw new AppError(
      `Total capacity cannot be lower than ${outcome.committed} tickets already committed to active reservations and confirmed bookings.`,
      409,
    )
  }
  try {
    return serializeTicketType(outcome.ticketType)
  } catch (error) {
    mapUniqueNameError(error)
  }
}

module.exports = { listTicketTypes, createTicketType, updateTicketType }
