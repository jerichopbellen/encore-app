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
    // A hosting proxy can reject a large upload before it reaches Encore, without a JSON body.
    const fallbackMessage = response.status === 413
      ? 'The upload is too large. Choose a smaller image.'
      : 'The event management request failed.'
    const error = new Error(payload?.message || fallbackMessage)
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

// expected_poster names the poster the admin was looking at ("none" for the
// default poster), so a stale page cannot replace or remove a newer poster.
function posterPath(eventId, expectedPosterPublicId) {
  const query = new URLSearchParams({ expected_poster: expectedPosterPublicId || 'none' })
  return `/${encodeURIComponent(eventId)}/poster?${query}`
}

// The image is sent as the raw request body; the API checks its size and content.
export function uploadAdminEventPoster(eventId, file, expectedPosterPublicId) {
  return requestAdminEventsApi(posterPath(eventId, expectedPosterPublicId), {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': file.type },
  })
}

export function removeAdminEventPoster(eventId, expectedPosterPublicId) {
  return requestAdminEventsApi(posterPath(eventId, expectedPosterPublicId), { method: 'DELETE' })
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
