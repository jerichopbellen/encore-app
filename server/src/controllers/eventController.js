const AppError = require('../utils/AppError')
const eventService = require('../services/eventService')
const reservationService = require('../services/reservationService')
const { serializeEvent } = require('../utils/eventSerializer')
const { validateEventId } = require('../validators/eventValidator')

async function listEvents(req, res) {
  await reservationService.releaseExpiredReservations()
  const events = await eventService.listPublishedEvents()

  return res.status(200).json({
    success: true,
    data: events.map(serializeEvent),
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
