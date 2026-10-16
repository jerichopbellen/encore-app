const AppError = require('../utils/AppError')
const eventService = require('../services/eventService')
const reservationService = require('../services/reservationService')
const { serializeEvent } = require('../utils/eventSerializer')
const { validateEventId } = require('../validators/eventValidator')
const { normalizeCatalogueQuery } = require('../validators/catalogueValidator')

async function listEvents(req, res) {
  const query = normalizeCatalogueQuery(req.query)
  await reservationService.releaseExpiredReservations()
  const result = await eventService.listPublishedEvents(query)

  return res.status(200).json({
    success: true,
    data: {
      events: result.events.map(serializeEvent),
      pagination: result.pagination,
    },
  })
}

async function getEvent(req, res) {
  const { eventId } = req.params

  validateEventId(eventId)

  await reservationService.releaseExpiredReservations()
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
