const { getPrismaClient } = require('../config/prisma')
const { publicEventFields: publicTicketTypeFields } = require('./TicketType')

const publicEventFields = {
  id: true,
  title: true,
  description: true,
  venue: true,
  starts_at: true,
  status: true,
  ticket_types: {
    select: publicTicketTypeFields,
    orderBy: { name: 'asc' },
  },
}

async function findPublishedEvents() {
  const prisma = await getPrismaClient()

  return prisma.events.findMany({
    where: { status: 'published' },
    orderBy: { starts_at: 'asc' },
    select: publicEventFields,
  })
}

async function findPublishedEventById(id) {
  const prisma = await getPrismaClient()

  return prisma.events.findFirst({
    where: { id, status: 'published' },
    select: publicEventFields,
  })
}

module.exports = { findPublishedEvents, findPublishedEventById }
