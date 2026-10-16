import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { useAuth } from '../../contexts/AuthContext'
import { getAdminDashboard } from '../../services/adminDashboardApi'
import { formatEventDate } from '../../utils/eventDisplay'

function AdminDashboardPage() {
  const { user, isLoading: isAuthLoading } = useAuth()
  const [dashboard, setDashboard] = useState(null)
  const [loadState, setLoadState] = useState('loading')
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    if (isAuthLoading || user?.role !== 'admin') return undefined
    let isCurrentRequest = true
    getAdminDashboard()
      .then((data) => {
        if (isCurrentRequest) {
          setDashboard(data)
          setLoadState('success')
        }
      })
      .catch(() => {
        if (isCurrentRequest) setLoadState('error')
      })
    return () => { isCurrentRequest = false }
  }, [isAuthLoading, retryCount, user])

  if (isAuthLoading) return <p className="admin-events-state" role="status">Checking your session…</p>
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') {
    return (
      <section className="admin-events-state" role="alert">
        <p className="eyebrow">ADMIN ACCESS</p>
        <h1>Administrator access is required.</h1>
        <p>Your account does not have permission to view the dashboard.</p>
        <Link className="button-link" to="/">Back to events</Link>
      </section>
    )
  }

  if (loadState === 'loading') return <p className="admin-events-state" role="status">Loading dashboard…</p>
  if (loadState === 'error') {
    return (
      <section className="admin-dashboard__state" role="alert">
        <h1>Dashboard unavailable</h1>
        <p>Encore could not load the latest overview. Check your connection and try again.</p>
        <button className="button-link" type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again</button>
      </section>
    )
  }

  const events = dashboard.event_counts
  const tickets = dashboard.ticket_inventory
  const reservations = dashboard.reservation_counts

  return (
    <section className="admin-dashboard" aria-labelledby="admin-dashboard-title">
      <header className="admin-dashboard__heading">
        <div>
          <p className="eyebrow">ENCORE ADMIN</p>
          <h1 id="admin-dashboard-title">Dashboard overview</h1>
          <p>A current snapshot of your events, ticket inventory, reservations, and bookings.</p>
        </div>
        <Link className="button-link" to="/admin/events">Manage events</Link>
      </header>

      <section className="admin-dashboard__overview" aria-label="Platform overview">
        <article className="admin-dashboard__hero-card admin-dashboard__hero-card--events">
          <div className="admin-dashboard__card-kicker">
            <span>Event catalogue</span>
            <span>All statuses</span>
          </div>
          <div className="admin-dashboard__primary-value">
            <span>Total events</span>
            <strong>{events.total.toLocaleString()}</strong>
          </div>
          <div className="admin-dashboard__event-breakdown">
            <div><span>Published</span><strong>{events.published.toLocaleString()}</strong></div>
            <div><span>Drafts</span><strong>{events.draft.toLocaleString()}</strong></div>
          </div>
        </article>

        <article className="admin-dashboard__hero-card admin-dashboard__hero-card--inventory">
          <div className="admin-dashboard__card-kicker">
            <span>Ticket inventory</span>
            <span>{tickets.ticket_type_count.toLocaleString()} ticket types</span>
          </div>
          <div className="admin-dashboard__primary-value admin-dashboard__primary-value--inventory">
            <span>Available tickets</span>
            <strong>{tickets.available_quantity.toLocaleString()}</strong>
          </div>
          <div className="admin-dashboard__capacity-summary">
            <span>Total capacity</span>
            <strong>{tickets.total_capacity.toLocaleString()}</strong>
          </div>
          <Link className="admin-dashboard__text-link" to="/admin/events">Manage ticket types by event <span aria-hidden="true">→</span></Link>
        </article>
      </section>

      <div className="admin-dashboard__operations">
        <section className="admin-dashboard__panel" aria-labelledby="reservation-summary-title">
          <header className="admin-dashboard__panel-heading">
            <div>
              <p className="eyebrow">BOOKING ACTIVITY</p>
              <h2 id="reservation-summary-title">Reservations</h2>
            </div>
            <span className="admin-dashboard__count-pill">{reservations.total.toLocaleString()} total</span>
          </header>
          <dl className="admin-dashboard__status-list">
            <div><dt>Active pending</dt><dd>{reservations.pending.toLocaleString()}</dd></div>
            <div><dt>Confirmed reservations</dt><dd>{reservations.confirmed.toLocaleString()}</dd></div>
            <div><dt>Cancelled</dt><dd>{reservations.cancelled.toLocaleString()}</dd></div>
            <div><dt>Expired</dt><dd>{reservations.expired.toLocaleString()}</dd></div>
            <div className="admin-dashboard__status-list-wide"><dt>Expired holds awaiting processing</dt><dd>{reservations.pending_expired.toLocaleString()}</dd></div>
            {reservations.other > 0 && <div><dt>Other statuses</dt><dd>{reservations.other.toLocaleString()}</dd></div>}
          </dl>
          <div className="admin-dashboard__booking-summary">
            <div><span>Confirmed bookings</span><small>Simulated checkout completed</small></div>
            <strong>{dashboard.confirmed_booking_count.toLocaleString()}</strong>
          </div>
        </section>

        <section className="admin-dashboard__panel admin-dashboard__upcoming" aria-labelledby="upcoming-events-title">
          <header className="admin-dashboard__panel-heading">
            <div>
              <p className="eyebrow">WHAT’S NEXT</p>
              <h2 id="upcoming-events-title">Upcoming events</h2>
            </div>
            <Link className="admin-dashboard__text-link" to="/admin/events">View all <span aria-hidden="true">→</span></Link>
          </header>
          {dashboard.upcoming_events.length === 0 ? (
            <p className="admin-dashboard__empty">No upcoming published events. Publish an event to feature it here.</p>
          ) : (
            <ul className="admin-dashboard__event-list">
              {dashboard.upcoming_events.map((event) => (
                <li key={event.id}>
                  <div className="admin-dashboard__event-date">
                    <span>{formatEventDate(event.starts_at, { month: 'short' })}</span>
                    <strong>{formatEventDate(event.starts_at, { day: '2-digit' })}</strong>
                  </div>
                  <div className="admin-dashboard__event-info">
                    <h3>{event.title}</h3>
                    <p>{event.venue}</p>
                    <time dateTime={event.starts_at}>{formatEventDate(event.starts_at, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</time>
                  </div>
                  <Link to={`/admin/events/${event.id}`} aria-label={`Manage ${event.title}`}>Manage</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  )
}

export default AdminDashboardPage
