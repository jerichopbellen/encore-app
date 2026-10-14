import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { useAuth } from '../../contexts/AuthContext'
import { getReservations } from '../../services/reservationsApi'
import { formatPrice } from '../../utils/eventDisplay'

const reservationStatusLabels = {
  pending: 'Active',
  confirmed: 'Confirmed',
  expired: 'Expired',
  cancelled: 'Cancelled',
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getStatusLabel(status) {
  return reservationStatusLabels[status]
    || status.charAt(0).toUpperCase() + status.slice(1)
}

function getStatusClass(status) {
  return Object.hasOwn(reservationStatusLabels, status) ? status : 'other'
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
        <div className="reservations-state" role="status" aria-live="polite">
          <span className="reservations-state__mark" aria-hidden="true">◷</span>
          <p>Loading your reservations…</p>
        </div>
      ) : loadState.status === 'error' ? (
        <div className="reservations-state reservations-state--error" role="alert">
          <span className="reservations-state__mark" aria-hidden="true">!</span>
          <div>
            <h2>We couldn’t load your reservations</h2>
            <p>{loadState.message}</p>
          </div>
          <button className="button-link reservations-state__action" type="button" onClick={() => {
            setLoadState({ status: 'loading' })
            setRetryCount((count) => count + 1)
          }}>
            Try again
          </button>
        </div>
      ) : loadState.reservations.length === 0 ? (
        <div className="reservations-empty">
          <span className="reservations-empty__mark" aria-hidden="true">✦</span>
          <p className="eyebrow">YOUR NEXT NIGHT OUT</p>
          <h2>No reservations yet</h2>
          <p>When you reserve tickets, the event, ticket details, and hold status will appear here.</p>
          <Link className="button-link" to="/">Explore events</Link>
        </div>
      ) : (
        <div className="reservation-list">
          {loadState.reservations.map((reservation) => (
            <article className="reservation-card" key={reservation.id}>
              <header className="reservation-card__header">
                <div>
                  <p className="eyebrow">TICKET RESERVATION</p>
                  <h2>{reservation.items[0]?.event.title || 'Encore event'}</h2>
                </div>
                <span
                  className={`reservation-status reservation-status--${getStatusClass(reservation.status)}`}
                  aria-label={`Reservation status: ${getStatusLabel(reservation.status)}`}
                >
                  <span className="reservation-status__dot" aria-hidden="true" />
                  {getStatusLabel(reservation.status)}
                </span>
              </header>
              {reservation.items[0]?.event && (
                <div className="reservation-card__event-meta">
                  <span><span aria-hidden="true">⌖</span> {reservation.items[0].event.venue}</span>
                  <time dateTime={reservation.items[0].event.starts_at}>
                    <span aria-hidden="true">◷</span> {formatDate(reservation.items[0].event.starts_at)}
                  </time>
                </div>
              )}
              <div className="reservation-card__details">
                <div className="reservation-card__timeline">
                  <span>Reserved</span>
                  <time dateTime={reservation.created_at}>{formatDate(reservation.created_at)}</time>
                  {reservation.status === 'pending' && (
                    <span className="reservation-card__hold-until">
                      Hold ends {formatDate(reservation.expires_at)}
                    </span>
                  )}
                  {reservation.status === 'expired' && (
                    <span className="reservation-card__hold-until">
                      Hold ended {formatDate(reservation.expires_at)}
                    </span>
                  )}
                </div>
                <div className="reservation-card__tickets">
                  <p className="reservation-card__section-label">Ticket details</p>
                  <ul className="reservation-card__items">
                    {reservation.items.map((item) => (
                      <li key={item.id}>
                        <div className="reservation-card__ticket-info">
                          <h3>{item.ticket_name}</h3>
                          <p>{item.quantity} <span>×</span> {formatPrice(item.unit_price)} each</p>
                        </div>
                        <strong>{formatPrice(item.line_total)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <footer className="reservation-card__total">
                <span>Reservation total</span>
                <strong>{formatPrice(reservation.total_amount)}</strong>
              </footer>
              {reservation.status === 'pending' && (
                <div className="reservation-card__checkout">
                  <Link className="button-link" to={`/reservations/${reservation.id}/checkout`}>Review checkout</Link>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export default ReservationsPage
