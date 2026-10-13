const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

async function requestReservationsApi(path, options = {}) {
  let response

  try {
    response = await fetch(`${apiBaseUrl}/api/reservations${path}`, {
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
    const error = new Error(payload?.message || 'The reservation request failed.')
    error.status = response.status
    throw error
  }
  if (!payload?.success || !('data' in payload)) {
    throw new Error('Encore returned an unexpected reservation response.')
  }

  return payload.data
}

export function createReservation(details) {
  return requestReservationsApi('', {
    method: 'POST',
    body: JSON.stringify(details),
  })
}

export function getReservations() {
  return requestReservationsApi('')
}

export function cancelReservation(reservationId) {
  return requestReservationsApi(`/${encodeURIComponent(reservationId)}/cancel`, {
    method: 'POST',
  })
}
