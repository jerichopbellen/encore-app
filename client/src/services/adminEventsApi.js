import { readAdminEventsResponse } from './adminEventsResponse'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

async function requestAdminEventsApi(path, options = {}) {
  let response
  try {
    response = await fetch(`${apiBaseUrl}/api/admin/events${path}`, {
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
