import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../../contexts/AuthContext'
import AuthSessionNotice from '../../components/auth/AuthSessionNotice'
import { checkoutReservation, getReservation } from '../../services/reservationsApi'
import { cancelReservationPayment, getLatestReservationPayment, getPaymentProvider, startReservationPayment } from '../../services/paymentsApi'
import { formatPrice } from '../../utils/eventDisplay'

function formatDate(value) {
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function storageKeyForReservation(reservationId) {
  return `encore:checkout:${reservationId}`
}

function readStoredCheckoutKey(reservationId) {
  try {
    return window.sessionStorage.getItem(storageKeyForReservation(reservationId))
  } catch {
    return null
  }
}

function storeCheckoutKey(reservationId, key) {
  try {
    window.sessionStorage.setItem(storageKeyForReservation(reservationId), key)
  } catch {
    // The in-memory ref still reuses the key for retries during this page view.
  }
}

function clearStoredCheckoutKey(reservationId) {
  try {
    window.sessionStorage.removeItem(storageKeyForReservation(reservationId))
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
}

// Turns the cancellation endpoint's answer into what the page may say. Only a 200 `cancelled` means
// Stripe confirmed the session is closed; a 409 means a payment is completed or in progress; any other
// failure means the outcome is unknown.
function cancelOutcome(reservationId) {
  return cancelReservationPayment(reservationId)
    .then((result) => ({ kind: result.outcome === 'cancelled' ? 'cancelled' : 'nothing-pending', payment: result.payment }))
    .catch((requestError) => ({ kind: requestError.status === 409 ? 'in-progress' : 'unknown', message: requestError.message }))
}

function CheckoutPage() {
  const { reservationId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, authStatus, isLoading: isAuthLoading } = useAuth()
  const [reservation, setReservation] = useState(null)
  const [loadState, setLoadState] = useState('loading')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const checkoutKeyRef = useRef(null)
  const [hasPendingCheckoutKey, setHasPendingCheckoutKey] = useState(false)
  // null while loading; the server enforces the mode, this only picks which button to show.
  const [paymentProvider, setPaymentProvider] = useState(null)
  const [providerError, setProviderError] = useState('')
  // The latest payment Encore has recorded for this reservation (Stripe mode only).
  const [existingPayment, setExistingPayment] = useState(null)
  // Captured once per visit. The parameter is removed from the address below, so a reload, a
  // restored tab or a later visit cannot ask Encore to close a newer payment session again.
  const [cancelReturn] = useState(() => searchParams.get('payment') === 'cancelled')
  const cancelRequestedRef = useRef(false)
  // Result of asking Encore to close the Stripe session after the customer came back from Stripe.
  // null means the request is still running; nothing is claimed until Stripe has answered.
  const [cancelResult, setCancelResult] = useState(null)

  useEffect(() => {
    checkoutKeyRef.current = readStoredCheckoutKey(reservationId)
    setHasPendingCheckoutKey(Boolean(checkoutKeyRef.current))
  }, [reservationId])

  useEffect(() => {
    if (isAuthLoading || !user) return undefined
    let active = true
    getReservation(reservationId)
      .then((result) => {
        if (!active) return
        setReservation(result)
        setLoadState('success')
      })
      .catch((requestError) => {
        if (!active) return
        setError(requestError.message)
        setLoadState('error')
      })
    return () => { active = false }
  }, [isAuthLoading, reservationId, user])

  useEffect(() => {
    let active = true
    getPaymentProvider()
      .then((provider) => { if (active) setPaymentProvider(provider) })
      .catch((requestError) => { if (active) setProviderError(requestError.message) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!cancelReturn) return
    // Keep the result in state but drop the parameter right away (replace, not push).
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous)
      next.delete('payment')
      return next
    }, { replace: true })
  }, [cancelReturn, setSearchParams])

  useEffect(() => {
    if (!cancelReturn || paymentProvider !== 'stripe' || isAuthLoading || !user || cancelRequestedRef.current) return
    // One request per visit. It is deliberately not cancelled by this effect's cleanup, so a
    // development double-render cannot discard the answer.
    cancelRequestedRef.current = true
    cancelOutcome(reservationId).then(setCancelResult)
  }, [cancelReturn, isAuthLoading, paymentProvider, reservationId, user])

  const refreshPayment = useCallback(async () => {
    try {
      setExistingPayment(await getLatestReservationPayment(reservationId))
    } catch {
      // The server still refuses a second payment; this only improves what the page shows.
    }
  }, [reservationId])

  useEffect(() => {
    if (paymentProvider !== 'stripe' || isAuthLoading || !user) return undefined
    let active = true
    getLatestReservationPayment(reservationId)
      .then((payment) => { if (active) setExistingPayment(payment) })
      .catch(() => {
        // The server still refuses a second payment; this only improves what the page shows.
      })
    return () => { active = false }
  }, [isAuthLoading, paymentProvider, reservationId, user])

  useEffect(() => {
    // A page restored from the browser back-forward cache keeps its old React state,
    // including a disabled "Opening Stripe…" button, so reset it and re-read the payment.
    function handlePageShow(event) {
      if (!event.persisted) return
      setIsSubmitting(false)
      refreshPayment()
    }
    window.addEventListener('pageshow', handlePageShow)
    return () => window.removeEventListener('pageshow', handlePageShow)
  }, [refreshPayment])

  if (isAuthLoading) return <p className="event-page-state" role="status">Checking your account…</p>
  if (authStatus === 'error') return <AuthSessionNotice />
  if (!user) return <Navigate to="/login" replace />

  async function handleCheckout() {
    setIsSubmitting(true)
    setError('')
    try {
      if (!checkoutKeyRef.current) {
        checkoutKeyRef.current = window.crypto.randomUUID()
        storeCheckoutKey(reservationId, checkoutKeyRef.current)
        setHasPendingCheckoutKey(true)
      }
      const booking = await checkoutReservation(reservationId, checkoutKeyRef.current)
      clearStoredCheckoutKey(reservationId)
      checkoutKeyRef.current = null
      setHasPendingCheckoutKey(false)
      navigate(`/bookings/${booking.id}`, { replace: true })
    } catch (requestError) {
      setError(requestError.message)
      try {
        setReservation(await getReservation(reservationId))
      } catch {
        // Keep the original checkout error visible if the follow-up refresh also fails.
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleStripePayment() {
    setIsSubmitting(true)
    setError('')
    try {
      const payment = await startReservationPayment(reservationId)
      if (!payment.checkout_url) throw new Error('Stripe checkout is not available for this reservation.')
      // Hand off to Stripe-hosted Checkout; Encore creates the booking only after Stripe confirms payment.
      window.location.assign(payment.checkout_url)
    } catch (requestError) {
      setError(requestError.message)
      try {
        setReservation(await getReservation(reservationId))
      } catch {
        // Keep the original payment error visible if the follow-up refresh also fails.
      }
      await refreshPayment()
      setIsSubmitting(false)
    }
  }

  const usesStripe = paymentProvider === 'stripe'

  function retryCancel() {
    setCancelResult(null)
    cancelOutcome(reservationId).then(setCancelResult)
  }
  // While Encore is still asking Stripe to close the old session, paying again stays disabled.
  const cancelChecking = usesStripe && cancelReturn && !cancelResult
  // A paid or under-review reservation must never show another payment button.
  const paymentSettled = usesStripe && ['needs_review', 'fulfilled'].includes(existingPayment?.status)

  return (
    <section className="checkout-page" aria-labelledby="checkout-title">
      <Link className="event-details__back" to="/account/reservations">← My reservations</Link>
      <header className="checkout-page__heading">
        <p className="eyebrow">SECURE YOUR PLANS</p>
        <h1 id="checkout-title">Review your tickets</h1>
        {usesStripe
          ? <p>Pay securely with Stripe to create your Encore booking. This is a test-mode checkout: use Stripe's test card numbers, no real money is charged.</p>
          : <p>Confirm this reservation to create your Encore booking. No payment will be charged in this simulated checkout.</p>}
      </header>
      {loadState === 'loading' ? <p className="event-page-state" role="status">Loading reservation…</p> : null}
      {loadState === 'error' ? <div className="checkout-state" role="alert"><p>{error}</p><Link className="button-link" to="/account/reservations">Return to reservations</Link></div> : null}
      {loadState === 'success' && reservation ? (
        <article className="checkout-card">
          <div className="checkout-card__header">
            <div><p className="eyebrow">{reservation.status === 'pending' ? 'RESERVATION ON HOLD' : 'RESERVATION STATUS'}</p><h2>{reservation.items[0]?.event.title || 'Encore event'}</h2></div>
            <span className={`reservation-status reservation-status--${reservation.status}`}>{reservation.status === 'pending' ? 'Active' : reservation.status}</span>
          </div>
          {reservation.items[0]?.event && <p className="checkout-card__meta">{reservation.items[0].event.venue} · {formatDate(reservation.items[0].event.starts_at)}</p>}
          <ul className="checkout-items">
            {reservation.items.map((item) => <li key={item.id}><span>{item.quantity} × {item.ticket_name}<small>{formatPrice(item.unit_price)} each</small></span><strong>{formatPrice(item.line_total)}</strong></li>)}
          </ul>
          <div className="checkout-card__total"><span>Total</span><strong>{formatPrice(reservation.total_amount)}</strong></div>
          {cancelReturn && usesStripe && !error && (
            <div className="checkout-state__note" role="status">
              {!cancelResult && <p>Checking with Stripe that your payment session was closed…</p>}
              {cancelResult?.kind === 'cancelled' && <p>Your Stripe payment session was closed and you were not charged for it. Your tickets stay on hold until the time shown below.</p>}
              {cancelResult?.kind === 'nothing-pending' && <p>No Stripe payment is waiting to be completed for this reservation.</p>}
              {cancelResult?.kind === 'in-progress' && (
                <p>
                  {cancelResult.message} <Link to={`/reservations/${reservationId}/payment/return`}>Check payment status</Link>{' '}
                  <button className="button-link" type="button" onClick={retryCancel}>Try again</button>
                </p>
              )}
              {cancelResult?.kind === 'unknown' && (
                <p>
                  We could not confirm with Stripe that your payment session was closed, so it may still be payable until it expires.{' '}
                  <button className="button-link" type="button" onClick={retryCancel}>Try again</button>
                </p>
              )}
            </div>
          )}
          {providerError && <p className="checkout-error" role="alert">{providerError}</p>}
          {error && <p className="checkout-error" role="alert">{error}</p>}
          {usesStripe && existingPayment?.status === 'needs_review' && (
            <p className="checkout-state__note" role="status">
              We received a payment for this reservation but could not finish your booking automatically, so it is under review. Please do not pay again. Reference: {existingPayment.id}.
            </p>
          )}
          {usesStripe && existingPayment?.status === 'fulfilled' && existingPayment.booking_id && (
            <p className="checkout-state__note" role="status">
              Payment received. <Link to={`/bookings/${existingPayment.booking_id}`}>View your booking</Link>.
            </p>
          )}
          {paymentSettled || cancelResult?.kind === 'in-progress' ? null : usesStripe && reservation.status === 'pending' ? (
            <button className="button-link checkout-submit" type="button" disabled={isSubmitting || cancelChecking} onClick={handleStripePayment}>
              {isSubmitting ? 'Opening Stripe…' : cancelChecking ? 'Checking your earlier payment…' : 'Pay with Stripe'}
            </button>
          ) : !usesStripe && (reservation.status === 'pending' || (reservation.status === 'confirmed' && hasPendingCheckoutKey)) ? (
            <button className="button-link checkout-submit" type="button" disabled={isSubmitting || !paymentProvider} onClick={handleCheckout}>
              {isSubmitting ? 'Confirming…' : reservation.status === 'confirmed' ? 'Recover booking confirmation' : 'Confirm simulated checkout'}
            </button>
          ) : (
            <p className="checkout-state__note">This reservation cannot be checked out. {reservation.status === 'confirmed' ? <Link to="/account/bookings">View your bookings</Link> : <Link to="/account/reservations">View your reservations</Link>}.</p>
          )}
          {reservation.status === 'pending' && <p className="checkout-card__expiry">Hold expires {formatDate(reservation.expires_at)}. {usesStripe ? 'Starting payment gives you extra time to finish paying.' : 'The server will re-check availability when you confirm.'}</p>}
        </article>
      ) : null}
    </section>
  )
}

export default CheckoutPage
