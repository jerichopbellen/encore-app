const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

async function requestEventsApi(path) {
  let response

  try {
    response = await fetch(`${apiBaseUrl}/api/events${path}`, {
      headers: { Accept: 'application/json' },
    })
  } catch {
    throw new Error('Could not connect to Encore. Check that the API is running and try again.')
  }

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const error = new Error(payload?.message || 'The event request failed.')
    error.status = response.status
    throw error
  }

  const validData = path === ''
    ? Array.isArray(payload?.data)
    : payload?.data && !Array.isArray(payload.data)

  if (!payload?.success || !validData) {
    throw new Error('Encore returned an unexpected event response.')
  }

  return payload.data
}

export function getEvents() {
  return requestEventsApi('')
}

export function getEvent(id) {
  return requestEventsApi(`/${encodeURIComponent(id)}`)
}
