const AppError = require('../utils/AppError')

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EVENT_FIELDS = new Set(['title', 'description', 'venue', 'starts_at'])
const STATUS_VALUES = new Set(['draft', 'published'])
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|([+-])(\d{2}):(\d{2}))$/i

function assertObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('A JSON object is required.', 400)
  }
}

function rejectUnknownFields(body, allowedFields) {
  const unknownFields = Object.keys(body).filter((field) => !allowedFields.has(field))
  if (unknownFields.length > 0) {
    throw new AppError(`Unsupported event field: ${unknownFields[0]}.`, 400)
  }
}

function normalizeTitle(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('Event title is required.', 400)
  }
  const title = value.trim()
  if (title.length > 200) throw new AppError('Event title must be 200 characters or fewer.', 400)
  return title
}

function normalizeVenue(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('Event venue is required.', 400)
  }
  const venue = value.trim()
  if (venue.length > 200) throw new AppError('Event venue must be 200 characters or fewer.', 400)
  return venue
}

function normalizeDescription(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new AppError('Event description must be text.', 400)
  return value.trim() || null
}

function normalizeStartsAt(value) {
  const match = typeof value === 'string' ? ISO_TIMESTAMP_PATTERN.exec(value) : null
  if (!match) {
    throw new AppError('Event start time must be a valid ISO timestamp with a timezone.', 400)
  }
  const [, yearPart, monthPart, dayPart, hourPart, minutePart, secondPart = '0', , , offsetHourPart = '0', offsetMinutePart = '0'] = match
  const year = Number(yearPart)
  const month = Number(monthPart)
  const day = Number(dayPart)
  const hour = Number(hourPart)
  const minute = Number(minutePart)
  const second = Number(secondPart)
  const calendarDate = new Date(0)
  calendarDate.setUTCFullYear(year, month - 1, day)
  calendarDate.setUTCHours(hour, minute, second, 0)

  if (
    month < 1 || month > 12 || day < 1 ||
    calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day ||
    hour > 23 || minute > 59 || second > 59 ||
    Number(offsetHourPart) > 23 || Number(offsetMinutePart) > 59
  ) {
    throw new AppError('Event start time must be a valid date.', 400)
  }
  const startsAt = new Date(value)
  if (Number.isNaN(startsAt.getTime())) {
    throw new AppError('Event start time must be a valid date.', 400)
  }
  return startsAt
}

function requireFutureStartTime(startsAt, now) {
  if (startsAt.getTime() <= now.getTime()) {
    throw new AppError('Event start time must be in the future.', 400)
  }
  return startsAt
}

function validateEventId(eventId) {
  if (typeof eventId !== 'string' || !UUID_PATTERN.test(eventId)) {
    throw new AppError('Event ID must be a valid UUID.', 400)
  }
}

function normalizeCreateEventInput(body, now = new Date()) {
  assertObject(body)
  const allowedFields = new Set([...EVENT_FIELDS])
  rejectUnknownFields(body, allowedFields)

  return {
    title: normalizeTitle(body.title),
    description: normalizeDescription(body.description),
    venue: normalizeVenue(body.venue),
    starts_at: requireFutureStartTime(normalizeStartsAt(body.starts_at), now),
  }
}

function normalizeUpdateEventInput(body, now = new Date()) {
  assertObject(body)
  rejectUnknownFields(body, EVENT_FIELDS)
  const fields = Object.keys(body)
  if (fields.length === 0) throw new AppError('Provide at least one event field to update.', 400)

  const update = {}
  if (Object.hasOwn(body, 'title')) update.title = normalizeTitle(body.title)
  if (Object.hasOwn(body, 'description')) update.description = normalizeDescription(body.description)
  if (Object.hasOwn(body, 'venue')) update.venue = normalizeVenue(body.venue)
  if (Object.hasOwn(body, 'starts_at')) {
    update.starts_at = requireFutureStartTime(normalizeStartsAt(body.starts_at), now)
  }
  return update
}

function normalizeEventStatusInput(body) {
  assertObject(body)
  rejectUnknownFields(body, new Set(['status']))
  if (!STATUS_VALUES.has(body.status)) {
    throw new AppError('Event status must be either draft or published.', 400)
  }
  return { status: body.status }
}

module.exports = {
  normalizeCreateEventInput,
  normalizeUpdateEventInput,
  normalizeEventStatusInput,
  validateEventId,
}
