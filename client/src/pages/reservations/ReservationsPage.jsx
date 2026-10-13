import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { useAuth } from '../../contexts/AuthContext'
import { getReservations } from '../../services/reservationsApi'
import { formatPrice } from '../../utils/eventDisplay'

function formatDate(value) {
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function ReservationsPage() {
  const { user, isLoading: isAuthLoading } = useAuth()
  const [loadState, setLoadState] = useState({ status: 'loading' })
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    if (isAuthLoading || !user) return undefined

    let isCurrentRequest = true
    getReservations()
      .then((reservations) => {
        if (isCurrentRequest) setLoadState({ status: 'success', reservations })
      })
      .catch((error) => {
        if (isCurrentRequest) setLoadState({ status: 'error', message: error.message })
      })

    return () => { isCurrentRequest = false }
  }, [isAuthLoading, retryCount, user])

  if (isAuthLoading) {
    return <p className="event-page-state" role="status">Checking your account…</p>
  }
  if (!user) return <Navigate to="/login" replace />

  return (
    <section className="reservations-page" aria-labelledby="reservations-title">
      <header className="reservations-page__heading">
        <p className="eyebrow">YOUR ENCORE ACCOUNT</p>
        <h1 id="reservations-title">My reservations</h1>
        <p>Review your ticket holds and reservation details.</p>
      </header>

      {loadState.status === 'loading' ? (
        <p className="event-page-state" role="status">Loading your reservations…</p>
      ) : loadState.status === 'error' ? (
        <div className="event-page-state" role="alert">
          <p>{loadState.message}</p>
          <button className="button-link" type="button" onClick={() => {
            setLoadState({ status: 'loading' })
            setRetryCount((count) => count + 1)
          }}>
            Try again
          </button>
        </div>
      ) : loadState.reservations.length === 0 ? (
        <div className="reservations-empty">
          <h2>No reservations yet</h2>
          <p>When you reserve tickets, their details and hold status will appear here.</p>
          <Link className="button-link" to="/">Explore events</Link>
        </div>
      ) : (
        <div className="reservation-list">
          {loadState.reservations.map((reservation) => (
            <article className="reservation-card" key={reservation.id}>
              <header className="reservation-card__header">
                <div>
                  <p className="eyebrow">RESERVATION</p>
                  <h2>{reservation.items[0]?.event.title || 'Encore event'}</h2>
                </div>
                <span className={`reservation-status reservation-status--${reservation.status}`}>
                  {reservation.status}
                </span>
              </header>
              <p className="reservation-card__meta">
                Created {formatDate(reservation.created_at)}
                {reservation.status === 'pending' && <> · Held until {formatDate(reservation.expires_at)}</>}
              </p>
              <ul className="reservation-card__items">
                {reservation.items.map((item) => (
                  <li key={item.id}>
                    <div>
                      <h3>{item.ticket_name}</h3>
                      <p>{item.event.venue} · {formatDate(item.event.starts_at)}</p>
                      <p>{item.quantity} × {formatPrice(item.unit_price)}</p>
                    </div>
                    <strong>{formatPrice(item.line_total)}</strong>
                  </li>
                ))}
              </ul>
              <footer className="reservation-card__total">
                <span>Reservation total</span>
                <strong>{formatPrice(reservation.total_amount)}</strong>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export default ReservationsPage
