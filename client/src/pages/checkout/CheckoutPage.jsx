import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { useAuth } from '../../contexts/AuthContext'
import { checkoutReservation, getReservation } from '../../services/reservationsApi'
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

function CheckoutPage() {
  const { reservationId } = useParams()
  const navigate = useNavigate()
  const { user, isLoading: isAuthLoading } = useAuth()
  const [reservation, setReservation] = useState(null)
  const [loadState, setLoadState] = useState('loading')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const checkoutKeyRef = useRef(null)
  const [hasPendingCheckoutKey, setHasPendingCheckoutKey] = useState(false)

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

  if (isAuthLoading) return <p className="event-page-state" role="status">Checking your account…</p>
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

  return (
    <section className="checkout-page" aria-labelledby="checkout-title">
      <Link className="event-details__back" to="/account/reservations">← My reservations</Link>
      <header className="checkout-page__heading">
        <p className="eyebrow">SECURE YOUR PLANS</p>
        <h1 id="checkout-title">Review your tickets</h1>
        <p>Confirm this reservation to create your Encore booking. No payment will be charged in this simulated checkout.</p>
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
          {error && <p className="checkout-error" role="alert">{error}</p>}
          {reservation.status === 'pending' || (reservation.status === 'confirmed' && hasPendingCheckoutKey) ? (
            <button className="button-link checkout-submit" type="button" disabled={isSubmitting} onClick={handleCheckout}>
              {isSubmitting ? 'Confirming…' : reservation.status === 'confirmed' ? 'Recover booking confirmation' : 'Confirm simulated checkout'}
            </button>
          ) : (
            <p className="checkout-state__note">This reservation cannot be checked out. {reservation.status === 'confirmed' ? <Link to="/account/bookings">View your bookings</Link> : <Link to="/account/reservations">View your reservations</Link>}.</p>
          )}
          {reservation.status === 'pending' && <p className="checkout-card__expiry">Hold expires {formatDate(reservation.expires_at)}. The server will re-check availability when you confirm.</p>}
        </article>
      ) : null}
    </section>
  )
}

export default CheckoutPage
