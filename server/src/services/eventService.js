const { getPrismaClient } = require('../config/prisma')

// Keep the event query and its public ticket fields together in the service.
const publicEventFields = {
  id: true,
  title: true,
  description: true,
  venue: true,
  starts_at: true,
  status: true,
  ticket_types: {
    select: {
      id: true,
      name: true,
      price: true,
      total_quantity: true,
      available_quantity: true,
    },
    orderBy: { name: 'asc' },
  },
}

async function listPublishedEvents({ page, pageSize, search, availableOnly, sort }) {
  const prisma = await getPrismaClient()
  const where = { status: 'published' }
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { venue: { contains: search, mode: 'insensitive' } },
    ]
  }
  if (availableOnly) where.ticket_types = { some: { available_quantity: { gt: 0 } } }

  const orderBy = sort === 'latest'
    ? [{ starts_at: 'desc' }, { id: 'asc' }]
    : sort === 'recently-added'
      ? [{ created_at: 'desc' }, { id: 'asc' }]
      : [{ starts_at: 'asc' }, { id: 'asc' }]

  return prisma.$transaction(async (tx) => {
    const totalEvents = await tx.events.count({ where })
    const skip = (page - 1) * pageSize
    // Return an empty page directly for out-of-range requests. Apart from
    // avoiding a pointless query, this keeps enormous valid page numbers out
    // of Prisma's skip argument when the catalogue has only a few rows.
    const events = skip >= totalEvents ? [] : await tx.events.findMany({
      where,
      orderBy,
      skip,
      take: pageSize,
      select: publicEventFields,
    })
    return {
      events,
      pagination: {
        page,
        page_size: pageSize,
        total_events: totalEvents,
        total_pages: Math.ceil(totalEvents / pageSize),
      },
    }
  }, { isolationLevel: 'RepeatableRead' })
}

async function getPublishedEventById(id) {
  const prisma = await getPrismaClient()
  return prisma.events.findFirst({
    where: { id, status: 'published' },
    select: publicEventFields,
  })
}

async function listAdminEvents() {
  const prisma = await getPrismaClient()
  return prisma.events.findMany({
    orderBy: { starts_at: 'asc' },
    select: publicEventFields,
  })
}

async function createEvent(data) {
  const prisma = await getPrismaClient()
  return prisma.events.create({
    data,
    select: publicEventFields,
  })
}

async function updateEvent(id, data) {
  const prisma = await getPrismaClient()
  const existing = await prisma.events.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return null

  return prisma.events.update({
    where: { id },
    data,
    select: publicEventFields,
  })
}

async function updateEventStatus(id, status) {
  return updateEvent(id, { status })
}

module.exports = {
  listPublishedEvents,
  getPublishedEventById,
  listAdminEvents,
  createEvent,
  updateEvent,
  updateEventStatus,
}
