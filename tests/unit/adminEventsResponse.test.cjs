const test = require('node:test')
const assert = require('node:assert/strict')

test('accepts the event array returned by the admin list endpoint', async () => {
  const { readAdminEventsResponse } = await import('../../client/src/services/adminEventsResponse.js')
  const events = [{ id: 'event-1' }]

  assert.equal(readAdminEventsResponse({ success: true, data: events }, true), events)
})

test('accepts the single event returned by the admin create endpoint', async () => {
  const { readAdminEventsResponse } = await import('../../client/src/services/adminEventsResponse.js')
  const event = { id: 'event-1', status: 'draft' }

  assert.equal(readAdminEventsResponse({ success: true, data: event }, false), event)
})

test('rejects an event response with the wrong data shape', async () => {
  const { readAdminEventsResponse } = await import('../../client/src/services/adminEventsResponse.js')

  assert.throws(
    () => readAdminEventsResponse({ success: true, data: { id: 'event-1' } }, true),
    /unexpected event management response/,
  )
})

test('rejects a non-object payload for an event mutation response', async () => {
  const { readAdminEventsResponse } = await import('../../client/src/services/adminEventsResponse.js')

  assert.throws(
    () => readAdminEventsResponse({ success: true, data: 'created' }, false),
    /unexpected event management response/,
  )
})
