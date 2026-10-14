import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { useAuth } from '../../contexts/AuthContext'
import { getBooking } from '../../services/bookingsApi'
import { formatPrice } from '../../utils/eventDisplay'

function BookingConfirmationPage() {
  const { bookingId } = useParams()
  const { user, isLoading: isAuthLoading } = useAuth()
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    if (isAuthLoading || !user) return undefined
    let active = true
    getBooking(bookingId)
      .then((booking) => { if (active) setState({ status: 'success', booking }) })
      .catch((error) => { if (active) setState({ status: 'error', message: error.message }) })
    return () => { active = false }
  }, [bookingId, isAuthLoading, user])

  if (isAuthLoading) return <p className="event-page-state" role="status">Checking your account…</p>
  if (!user) return <Navigate to="/login" replace />
  if (state.status === 'loading') return <p className="event-page-state" role="status">Loading booking…</p>
  if (state.status === 'error') return <section className="booking-state" role="alert"><h1>We couldn’t find that booking</h1><p>{state.message}</p><Link className="button-link" to="/bookings">My bookings</Link></section>

  const { booking } = state
  return (
    <section className="booking-confirmation" aria-labelledby="booking-title">
      <div className="booking-confirmation__mark" aria-hidden="true">✓</div>
      <p className="eyebrow">BOOKING CONFIRMED</p>
      <h1 id="booking-title">You’re going!</h1>
      <p className="booking-confirmation__intro">Your simulated checkout is complete. Your booking details are saved to your Encore account.</p>
      <article className="booking-card">
        <div className="booking-card__header"><div><p className="eyebrow">BOOKING REFERENCE</p><h2>{booking.id}</h2></div><span className="reservation-status reservation-status--confirmed">Confirmed</span></div>
        {booking.items.map((item) => <div className="booking-card__item" key={item.id}><div><h3>{item.event.title}</h3><p>{item.event.venue} · {new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.event.starts_at))}</p><p>{item.quantity} × {item.ticket_name}</p></div><strong>{formatPrice(item.line_total)}</strong></div>)}
        <div className="checkout-card__total"><span>Total</span><strong>{formatPrice(booking.total_amount)}</strong></div>
      </article>
      <div className="booking-confirmation__actions"><Link className="button-link" to="/bookings">View my bookings</Link><Link className="booking-text-link" to="/">Discover more events</Link></div>
    </section>
  )
}

export default BookingConfirmationPage
