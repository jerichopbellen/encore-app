const AppError = require('../utils/AppError')
const eventService = require('../services/eventService')
const ticketTypeService = require('../services/ticketTypeService')
const dashboardService = require('../services/dashboardService')
const { serializeEvent } = require('../utils/eventSerializer')
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

async function listEvents(req, res) {
  const events = await eventService.listAdminEvents()
  return res.status(200).json({ success: true, data: events.map(serializeEvent) })
}

async function getDashboard(req, res) {
  const dashboard = await dashboardService.getDashboardOverview()
  return res.status(200).json({ success: true, data: dashboard })
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
  listTicketTypes,
  createTicketType,
  updateTicketType,
}
