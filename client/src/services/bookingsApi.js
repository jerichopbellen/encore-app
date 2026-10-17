import { apiUrl } from './apiUrl'

async function requestBookingsApi(path = '') {
  const url = apiUrl(`/bookings${path}`)
  let response
  try {
    response = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
  } catch {
    throw new Error('Could not connect to Encore. Check that the API is running and try again.')
  }

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(payload?.message || 'The booking request failed.')
    error.status = response.status
    throw error
  }
  if (!payload?.success || !('data' in payload)) {
    throw new Error('Encore returned an unexpected booking response.')
  }
  return payload.data
}

export function getBookings() {
  return requestBookingsApi()
}

export async function getBooking(bookingId) {
  const data = await requestBookingsApi(`/${encodeURIComponent(bookingId)}`)
  return data.booking
}
