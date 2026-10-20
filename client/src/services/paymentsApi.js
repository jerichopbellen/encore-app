import { apiUrl } from './apiUrl'

async function requestPaymentsApi(path, options = {}) {
  let response

  try {
    response = await fetch(apiUrl(path), {
      ...options,
      credentials: 'include',
      headers: { Accept: 'application/json', ...options.headers },
    })
  } catch {
    throw new Error('Could not connect to Encore. Check that the API is running and try again.')
  }

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(payload?.message || 'The payment request failed.')
    error.status = response.status
    throw error
  }
  if (!payload?.success || !('data' in payload)) {
    throw new Error('Encore returned an unexpected payment response.')
  }

  return payload.data
}

// Tells the checkout page whether to offer simulated checkout or Stripe-hosted Checkout.
export async function getPaymentProvider() {
  const data = await requestPaymentsApi('/payments/config')
  return data.provider
}

// Creates (or resumes) the Stripe-hosted Checkout Session. The server prices it; no amount is sent.
export async function startReservationPayment(reservationId) {
  const data = await requestPaymentsApi(`/reservations/${encodeURIComponent(reservationId)}/payments`, { method: 'POST' })
  return data.payment
}

// Asks Encore to close the customer's open Stripe session. Safe to repeat. The result's `outcome` is
// 'cancelled' only after Stripe confirmed the session can no longer be paid. A 409 means the payment
// already completed or is being processed; any other failure means the outcome is unknown.
export async function cancelReservationPayment(reservationId) {
  return requestPaymentsApi(`/reservations/${encodeURIComponent(reservationId)}/payments/cancel`, { method: 'POST' })
}

// Reports what Encore has recorded. A booking exists only once this says `fulfilled`.
export async function getLatestReservationPayment(reservationId) {
  const data = await requestPaymentsApi(`/reservations/${encodeURIComponent(reservationId)}/payments/latest`)
  return data.payment
}
