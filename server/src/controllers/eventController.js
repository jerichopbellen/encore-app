const AppError = require('../utils/AppError')
const eventService = require('../services/eventService')

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function serializeEvent(event) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    venue: event.venue,
    starts_at: event.starts_at.toISOString(),
    status: event.status,
    ticket_types: event.ticket_types.map((ticketType) => ({
      id: ticketType.id,
      name: ticketType.name,
      price: ticketType.price.toFixed(2),
      total_quantity: ticketType.total_quantity,
      available_quantity: ticketType.available_quantity,
    })),
  }
}

async function listEvents(req, res) {
  const events = await eventService.listPublishedEvents()

  return res.status(200).json({
    success: true,
    data: events.map(serializeEvent),
  })
}

async function getEvent(req, res) {
  const { eventId } = req.params

  if (!UUID_PATTERN.test(eventId)) {
    throw new AppError('Event ID must be a valid UUID.', 400)
  }

  const event = await eventService.getPublishedEventById(eventId)

  if (!event) {
    throw new AppError('Event not found.', 404)
  }

  return res.status(200).json({
    success: true,
    data: serializeEvent(event),
  })
}

module.exports = { listEvents, getEvent }
