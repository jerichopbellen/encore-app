const test = require('node:test')
const assert = require('node:assert/strict')
const {
  normalizeCreateEventInput,
  normalizeUpdateEventInput,
  normalizeEventStatusInput,
  validateEventId,
} = require('../../server/src/validators/eventValidator')

const validEvent = {
  title: '  Encore Live  ',
  description: '  A special show  ',
  venue: '  Encore Arena  ',
  starts_at: '2030-04-25T19:30:00+08:00',
}

test('event creation normalizes allowed fields and leaves publication status to the database default', () => {
  const normalized = normalizeCreateEventInput(validEvent)
  assert.deepEqual(normalized, {
    title: 'Encore Live',
    description: 'A special show',
    venue: 'Encore Arena',
    starts_at: new Date(validEvent.starts_at),
  })
  assert.equal(Object.hasOwn(normalized, 'status'), false)
})

test('event creation rejects missing required fields, invalid dates, and non-editable fields', () => {
  for (const input of [
    { title: 'Missing venue', starts_at: validEvent.starts_at },
    { ...validEvent, starts_at: '2030-02-30T19:30:00Z' },
    { ...validEvent, starts_at: '2030-04-25T19:30:00' },
    { ...validEvent, ticket_types: [] },
    { ...validEvent, status: 'published' },
  ]) {
    assert.throws(() => normalizeCreateEventInput(input), (error) => error.statusCode === 400)
  }
})

test('event creation compares the full start instant against a controlled current time', () => {
  const now = new Date('2030-04-25T12:00:00.000Z')
  const createAt = (starts_at) => normalizeCreateEventInput({ ...validEvent, starts_at }, now)

  assert.equal(createAt('2030-04-25T12:00:01Z').starts_at.toISOString(), '2030-04-25T12:00:01.000Z')
  for (const startsAt of [
    '2030-04-24T23:59:59Z',
    '2030-04-25T11:59:59Z',
    '2030-04-26T00:30:00+14:00',
    '2030-04-25T12:00:00Z',
  ]) {
    assert.throws(() => createAt(startsAt), (error) => (
      error.statusCode === 400 && /future/.test(error.message)
    ))
  }
})

test('event updates require at least one allowed field and normalize nullable descriptions', () => {
  assert.deepEqual(normalizeUpdateEventInput({ description: '  ' }), { description: null })
  assert.deepEqual(normalizeUpdateEventInput({ title: ' Updated ' }), { title: 'Updated' })
  assert.throws(() => normalizeUpdateEventInput({}), (error) => error.statusCode === 400)
  assert.throws(() => normalizeUpdateEventInput({ status: 'published' }), (error) => error.statusCode === 400)
})

test('event updates reject an explicitly past start time but allow unrelated edits to an existing past event', () => {
  const now = new Date('2030-04-25T12:00:00.000Z')

  assert.throws(
    () => normalizeUpdateEventInput({ starts_at: '2005-01-01T00:00:00Z' }, now),
    (error) => error.statusCode === 400 && /future/.test(error.message),
  )
  assert.deepEqual(normalizeUpdateEventInput({ title: 'Updated legacy event' }, now), {
    title: 'Updated legacy event',
  })
})

test('event status accepts only the existing draft and published values', () => {
  assert.deepEqual(normalizeEventStatusInput({ status: 'draft' }), { status: 'draft' })
  assert.deepEqual(normalizeEventStatusInput({ status: 'published' }), { status: 'published' })
  assert.throws(() => normalizeEventStatusInput({ status: 'cancelled' }), (error) => error.statusCode === 400)
})

test('event IDs use the existing public API UUID response convention', () => {
  assert.doesNotThrow(() => validateEventId('c397f634-687f-45a2-a5c6-d4fac5a38a55'))
  assert.throws(() => validateEventId('not-a-uuid'), (error) => error.statusCode === 400)
})
