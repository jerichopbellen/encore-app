import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { useAuth } from '../../contexts/AuthContext'
import AuthSessionNotice from '../../components/auth/AuthSessionNotice'
import { getLatestReservationPayment } from '../../services/paymentsApi'

const POLL_INTERVAL_MS = 2000
const MAX_POLLS = 45

// Stripe sends the customer back here after Checkout. Redirect parameters are never
// trusted: the booking is shown only after Encore's own records say it was fulfilled.
function PaymentReturnPage() {
  const { reservationId } = useParams()
  const navigate = useNavigate()
  const { user, isLoading: isAuthLoading, authStatus } = useAuth()
  const [payment, setPayment] = useState(null)
  const [error, setError] = useState('')
  const [timedOut, setTimedOut] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const pollCount = useRef(0)

  const restart = useCallback(() => {
    pollCount.current = 0
    setTimedOut(false)
    setError('')
    setAttempt((value) => value + 1)
  }, [])

  useEffect(() => {
    if (isAuthLoading || !user) return undefined
    let active = true
    let timer

    async function poll() {
      try {
        const latest = await getLatestReservationPayment(reservationId)
        if (!active) return
        setPayment(latest)
        if (latest?.status === 'fulfilled' && latest.booking_id) {
          navigate(`/bookings/${latest.booking_id}`, { replace: true })
          return
        }
        // Keep waiting only while a payment could still be confirmed by the webhook.
        const waiting = !latest || latest.status === 'creating' || latest.status === 'open'
        if (!waiting) return
        pollCount.current += 1
        if (pollCount.current >= MAX_POLLS) {
          setTimedOut(true)
          return
        }
        timer = window.setTimeout(poll, POLL_INTERVAL_MS)
      } catch (requestError) {
        if (!active) return
        setError(requestError.message)
      }
    }

    poll()
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [attempt, isAuthLoading, navigate, reservationId, user])

  if (isAuthLoading) return <p className="event-page-state" role="status">Checking your account…</p>
  if (authStatus === 'error') return <AuthSessionNotice />
  if (!user) return <Navigate to="/login" replace />

  let content
  if (error) {
    content = (
      <div className="checkout-state" role="alert">
        <p>{error}</p>
        <button className="button-link" type="button" onClick={restart}>Try again</button>
      </div>
    )
  } else if (payment?.status === 'needs_review') {
    content = (
      <div className="checkout-state" role="status">
        <h2>We received your payment</h2>
        <p>We could not finish your booking automatically, so it needs a manual review. Your tickets are not confirmed yet. Keep this reference: {payment.id}.</p>
        <Link className="button-link" to="/account/bookings">View your bookings</Link>
      </div>
    )
  } else if (payment && ['expired', 'failed'].includes(payment.status)) {
    content = (
      <div className="checkout-state" role="status">
        <h2>We have not received a payment confirmation</h2>
        <p>Encore has not been told that this payment succeeded, and no booking has been created from it yet. If you completed the payment, wait a moment and check again. If the status stays unresolved, contact support and quote this reference: {payment.id}. If you did not pay, you can go back to checkout while your reservation is still on hold.</p>
        <button className="button-link" type="button" onClick={restart}>Check again</button>{' '}
        <Link className="button-link" to={`/reservations/${reservationId}/checkout`}>Back to checkout</Link>
      </div>
    )
  } else if (timedOut) {
    content = (
      <div className="checkout-state" role="status">
        <h2>Still confirming your payment</h2>
        <p>This is taking longer than usual. Your booking will appear in My bookings as soon as Encore receives the confirmation from Stripe.</p>
        <button className="button-link" type="button" onClick={restart}>Check again</button>{' '}
        <Link className="button-link" to="/account/bookings">View your bookings</Link>
      </div>
    )
  } else {
    content = <p className="event-page-state" role="status">Confirming your payment with Stripe…</p>
  }

  return (
    <section className="checkout-page" aria-labelledby="payment-return-title">
      <header className="checkout-page__heading">
        <p className="eyebrow">PAYMENT</p>
        <h1 id="payment-return-title">Finishing your booking</h1>
      </header>
      {content}
    </section>
  )
}

export default PaymentReturnPage
