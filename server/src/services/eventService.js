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

async function listPublishedEvents() {
  const prisma = await getPrismaClient()
  return prisma.events.findMany({
    where: { status: 'published' },
    orderBy: { starts_at: 'asc' },
    select: publicEventFields,
  })
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
