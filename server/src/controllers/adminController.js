const AppError = require('../utils/AppError')
const eventService = require('../services/eventService')
const { serializeEvent } = require('../utils/eventSerializer')
const {
  normalizeCreateEventInput,
  normalizeUpdateEventInput,
  normalizeEventStatusInput,
  validateEventId,
} = require('../validators/eventValidator')
const notImplemented = require('../utils/notImplemented')

async function listEvents(req, res) {
  const events = await eventService.listAdminEvents()
  return res.status(200).json({ success: true, data: events.map(serializeEvent) })
}

async function createEvent(req, res) {
  const input = normalizeCreateEventInput(req.body)
  const event = await eventService.createEvent(input)
  return res.status(201).json({ success: true, data: serializeEvent(event) })
}

async function updateEvent(req, res) {
  validateEventId(req.params.eventId)
  const input = normalizeUpdateEventInput(req.body)
  const event = await eventService.updateEvent(req.params.eventId, input)
  if (!event) throw new AppError('Event not found.', 404)
  return res.status(200).json({ success: true, data: serializeEvent(event) })
}

async function updateEventStatus(req, res) {
  validateEventId(req.params.eventId)
  const { status } = normalizeEventStatusInput(req.body)
  const event = await eventService.updateEventStatus(req.params.eventId, status)
  if (!event) throw new AppError('Event not found.', 404)
  return res.status(200).json({ success: true, data: serializeEvent(event) })
}

function createTicketType(req, res) { return notImplemented(res, 'Creating a ticket type') }

module.exports = { listEvents, createEvent, updateEvent, updateEventStatus, createTicketType }
