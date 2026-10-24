const AppError = require('../utils/AppError')
const eventService = require('../services/eventService')
const ticketTypeService = require('../services/ticketTypeService')
const dashboardService = require('../services/dashboardService')
const eventPosterService = require('../services/eventPosterService')
const { serializeAdminEvent } = require('../utils/eventSerializer')
const {
  normalizeCreateEventInput,
  normalizeUpdateEventInput,
  normalizeEventStatusInput,
  validateEventId,
} = require('../validators/eventValidator')
const {
  normalizeCreateTicketTypeInput,
  normalizeUpdateTicketTypeInput,
} = require('../validators/ticketTypeValidator')
const { validatePosterUpload, normalizeExpectedPoster } = require('../validators/posterValidator')

async function listEvents(req, res) {
  const events = await eventService.listAdminEvents()
  return res.status(200).json({ success: true, data: events.map(serializeAdminEvent) })
}

async function getDashboard(req, res) {
  const dashboard = await dashboardService.getDashboardOverview()
  return res.status(200).json({ success: true, data: dashboard })
}

async function createEvent(req, res) {
  const input = normalizeCreateEventInput(req.body)
  const event = await eventService.createEvent(input)
  return res.status(201).json({ success: true, data: serializeAdminEvent(event) })
}

async function updateEvent(req, res) {
  validateEventId(req.params.eventId)
  const input = normalizeUpdateEventInput(req.body)
  const event = await eventService.updateEvent(req.params.eventId, input)
  if (!event) throw new AppError('Event not found.', 404)
  return res.status(200).json({ success: true, data: serializeAdminEvent(event) })
}

async function updateEventStatus(req, res) {
  validateEventId(req.params.eventId)
  const { status } = normalizeEventStatusInput(req.body)
  const event = await eventService.updateEventStatus(req.params.eventId, status)
  if (!event) throw new AppError('Event not found.', 404)
  return res.status(200).json({ success: true, data: serializeAdminEvent(event) })
}

async function uploadEventPoster(req, res) {
  validateEventId(req.params.eventId)
  const expectedPublicId = normalizeExpectedPoster(req.query.expected_poster)
  validatePosterUpload(req.body, req.get('Content-Type'))
  const event = await eventPosterService.uploadEventPoster(req.params.eventId, { buffer: req.body, expectedPublicId })
  if (!event) throw new AppError('Event not found.', 404)
  return res.status(200).json({ success: true, data: serializeAdminEvent(event) })
}

async function removeEventPoster(req, res) {
  validateEventId(req.params.eventId)
  const expectedPublicId = normalizeExpectedPoster(req.query.expected_poster)
  const event = await eventPosterService.removeEventPoster(req.params.eventId, { expectedPublicId })
  if (!event) throw new AppError('Event not found.', 404)
  return res.status(200).json({ success: true, data: serializeAdminEvent(event) })
}

async function listTicketTypes(req, res) {
  validateEventId(req.params.eventId)
  const ticketTypes = await ticketTypeService.listTicketTypes(req.params.eventId)
  if (!ticketTypes) throw new AppError('Event not found.', 404)
  return res.status(200).json({ success: true, data: ticketTypes })
}

async function createTicketType(req, res) {
  const input = normalizeCreateTicketTypeInput(req.params.eventId, req.body)
  const ticketType = await ticketTypeService.createTicketType(req.params.eventId, input)
  if (!ticketType) throw new AppError('Event not found.', 404)
  return res.status(201).json({ success: true, data: ticketType })
}

async function updateTicketType(req, res) {
  const input = normalizeUpdateTicketTypeInput(req.params.eventId, req.params.ticketTypeId, req.body)
  const ticketType = await ticketTypeService.updateTicketType(
    req.params.eventId,
    req.params.ticketTypeId,
    input,
  )
  if (!ticketType) throw new AppError('Ticket type not found for this event.', 404)
  return res.status(200).json({ success: true, data: ticketType })
}

module.exports = {
  getDashboard,
  listEvents,
  createEvent,
  updateEvent,
  updateEventStatus,
  uploadEventPoster,
  removeEventPoster,
  listTicketTypes,
  createTicketType,
  updateTicketType,
}
