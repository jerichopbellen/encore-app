import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { useAuth } from '../../contexts/AuthContext'
import { getBookings } from '../../services/bookingsApi'
import { formatPrice } from '../../utils/eventDisplay'

function BookingsPage() {
  const { user, isLoading: isAuthLoading } = useAuth()
  const [state, setState] = useState({ status: 'loading' })
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (isAuthLoading || !user) return undefined
    let active = true
    getBookings()
      .then((bookings) => { if (active) setState({ status: 'success', bookings }) })
      .catch((error) => { if (active) setState({ status: 'error', message: error.message }) })
    return () => { active = false }
  }, [isAuthLoading, retry, user])

  if (isAuthLoading) return <p className="event-page-state" role="status">Checking your account…</p>
  if (!user) return <Navigate to="/login" replace />

  return (
    <section className="bookings-page" aria-labelledby="bookings-title">
      <header className="checkout-page__heading"><p className="eyebrow">YOUR ENCORE ACCOUNT</p><h1 id="bookings-title">My bookings</h1><p>Your confirmed Encore event plans are collected here.</p></header>
      {state.status === 'loading' && <p className="event-page-state" role="status">Loading your bookings…</p>}
      {state.status === 'error' && <div className="checkout-state" role="alert"><p>{state.message}</p><button className="button-link" type="button" onClick={() => { setState({ status: 'loading' }); setRetry((count) => count + 1) }}>Try again</button></div>}
      {state.status === 'success' && state.bookings.length === 0 && <div className="reservations-empty"><span className="reservations-empty__mark" aria-hidden="true">✦</span><p className="eyebrow">YOUR NEXT NIGHT OUT</p><h2>No bookings yet</h2><p>When you confirm a reservation, your booking reference and ticket details will appear here.</p><Link className="button-link" to="/">Explore events</Link></div>}
      {state.status === 'success' && state.bookings.length > 0 && <div className="booking-list">{state.bookings.map((booking) => <article className="booking-list-card" key={booking.id}><div><p className="eyebrow">BOOKING REFERENCE</p><h2>{booking.items[0]?.event.title || 'Encore event'}</h2><p>{booking.items[0]?.event.venue} · {new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' }).format(new Date(booking.items[0]?.event.starts_at))}</p><span className="booking-list-card__reference">{booking.id}</span></div><div className="booking-list-card__side"><strong>{formatPrice(booking.total_amount)}</strong><Link to={`/bookings/${booking.id}`}>View booking <span aria-hidden="true">→</span></Link></div></article>)}</div>}
    </section>
  )
}

export default BookingsPage
