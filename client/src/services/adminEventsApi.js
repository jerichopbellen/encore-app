import { readAdminEventsResponse } from './adminEventsResponse'
import { apiUrl } from './apiUrl'

async function requestAdminEventsApi(path, options = {}) {
  const url = apiUrl(`/admin/events${path}`)
  let response
  try {
    response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    })
  } catch {
    throw new Error('Could not connect to Encore. Check that the API is running and try again.')
  }

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(payload?.message || 'The event management request failed.')
    error.status = response.status
    throw error
  }
  return readAdminEventsResponse(payload, (options.method || 'GET') === 'GET')
}

export function getAdminEvents() {
  return requestAdminEventsApi('')
}

export function createAdminEvent(event) {
  return requestAdminEventsApi('', { method: 'POST', body: JSON.stringify(event) })
}

export function updateAdminEvent(eventId, event) {
  return requestAdminEventsApi(`/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    body: JSON.stringify(event),
  })
}

export function updateAdminEventStatus(eventId, status) {
  return requestAdminEventsApi(`/${encodeURIComponent(eventId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export function getAdminTicketTypes(eventId) {
  return requestAdminEventsApi(`/${encodeURIComponent(eventId)}/ticket-types`)
}

export function createAdminTicketType(eventId, ticketType) {
  return requestAdminEventsApi(`/${encodeURIComponent(eventId)}/ticket-types`, {
    method: 'POST',
    body: JSON.stringify(ticketType),
  })
}

export function updateAdminTicketType(eventId, ticketTypeId, ticketType) {
  return requestAdminEventsApi(`/${encodeURIComponent(eventId)}/ticket-types/${encodeURIComponent(ticketTypeId)}`, {
    method: 'PATCH',
    body: JSON.stringify(ticketType),
  })
}
