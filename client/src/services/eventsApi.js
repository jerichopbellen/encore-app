const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

async function requestEventsApi(path, isListRequest = false) {
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

  const validData = isListRequest
    ? Array.isArray(payload?.data?.events) && payload?.data?.pagination && !Array.isArray(payload.data.pagination)
    : payload?.data && !Array.isArray(payload.data)

  if (!payload?.success || !validData) {
    throw new Error('Encore returned an unexpected event response.')
  }

  return payload.data
}

export function getEvents({ page = 1, pageSize = 12, search = '', availableOnly = false, sort = 'soonest' } = {}) {
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize), sort })
  if (search.trim()) query.set('q', search.trim())
  if (availableOnly) query.set('available', 'true')
  return requestEventsApi(`?${query}`, true)
}

export function getEvent(id) {
  return requestEventsApi(`/${encodeURIComponent(id)}`)
}
