import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { useAuth } from '../../contexts/AuthContext'
import AuthSessionNotice from '../../components/auth/AuthSessionNotice'
import { getAdminDashboard } from '../../services/adminDashboardApi'
import { formatEventDate } from '../../utils/eventDisplay'

function AdminDashboardPage() {
  const { user, authStatus, isLoading: isAuthLoading } = useAuth()
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
  if (authStatus === 'error') return <AuthSessionNotice />
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

  // Items that need an administrator's attention; each links to where it is handled.
  const todoItems = [
    {
      label: 'Draft events to review and publish',
      count: events.draft,
      to: '/admin/events',
      state: { status: 'draft' },
      action: 'Review drafts',
    },
    {
      label: 'Expired holds awaiting processing',
      count: reservations.pending_expired,
      hint: 'Tickets return to inventory when the next reservation activity processes them.',
    },
  ]
  const reservationActivity = [
    ['Active holds', reservations.pending],
    ['Confirmed', reservations.confirmed],
    ['Cancelled', reservations.cancelled],
    ['Expired', reservations.expired],
    ...(reservations.other > 0 ? [['Other statuses', reservations.other]] : []),
  ]

  return (
    <section className="admin-dashboard" aria-labelledby="admin-dashboard-title">
      <header className="admin-dashboard__heading">
        <div>
          <p className="eyebrow">ENCORE ADMIN</p>
          <h1 id="admin-dashboard-title">Dashboard</h1>
          <p>A current snapshot of your events, ticket inventory, reservations, and bookings.</p>
        </div>
        <div className="admin-dashboard__actions">
          <Link className="admin-events__secondary" to="/admin/events">Manage events</Link>
          <Link className="button-link" to="/admin/events/new">Create event</Link>
        </div>
      </header>

      <dl className="admin-dashboard__strip" aria-label="Key figures">
        <div className="admin-dashboard__figure">
          <dt>Events</dt>
          <dd className="admin-dashboard__figure-value">{events.total.toLocaleString()}</dd>
          <dd>{events.published.toLocaleString()} published · {events.draft.toLocaleString()} {events.draft === 1 ? 'draft' : 'drafts'}</dd>
        </div>
        <div className="admin-dashboard__figure">
          <dt>Tickets left</dt>
          <dd className="admin-dashboard__figure-value">{tickets.available_quantity.toLocaleString()}</dd>
          <dd>of {tickets.total_capacity.toLocaleString()} capacity · {tickets.ticket_type_count.toLocaleString()} ticket {tickets.ticket_type_count === 1 ? 'type' : 'types'}</dd>
        </div>
        <div className="admin-dashboard__figure">
          <dt>Active holds</dt>
          <dd className="admin-dashboard__figure-value">{reservations.pending.toLocaleString()}</dd>
          <dd>reservations awaiting checkout</dd>
        </div>
        <div className="admin-dashboard__figure">
          <dt>Bookings</dt>
          <dd className="admin-dashboard__figure-value">{dashboard.confirmed_booking_count.toLocaleString()}</dd>
          <dd>confirmed through checkout</dd>
        </div>
      </dl>

      <div className="admin-dashboard__columns">
        <section className="admin-dashboard__panel" aria-labelledby="needs-attention-title">
          <header className="admin-dashboard__panel-heading">
            <div>
              <p className="eyebrow">NEEDS ATTENTION</p>
              <h2 id="needs-attention-title">To do</h2>
            </div>
          </header>
          <ul className="admin-dashboard__todo">
            {todoItems.map((item) => (
              <li key={item.label} className={item.count > 0 ? 'admin-dashboard__todo-item admin-dashboard__todo-item--active' : 'admin-dashboard__todo-item'}>
                <div>
                  <span>{item.label}</span>
                  {item.count > 0 && item.to && (
                    <Link className="admin-dashboard__text-link" to={item.to} state={item.state}>{item.action} <span aria-hidden="true">→</span></Link>
                  )}
                  {item.count > 0 && item.hint && <small>{item.hint}</small>}
                </div>
                <strong>{item.count > 0 ? item.count.toLocaleString() : 'All clear'}</strong>
              </li>
            ))}
          </ul>
          <h3 className="admin-dashboard__subheading">Reservation activity <span>{reservations.total.toLocaleString()} total</span></h3>
          <dl className="admin-dashboard__status-list">
            {reservationActivity.map(([label, count]) => (
              <div key={label}><dt>{label}</dt><dd>{count.toLocaleString()}</dd></div>
            ))}
          </dl>
        </section>

        <section className="admin-dashboard__panel" aria-labelledby="upcoming-events-title">
          <header className="admin-dashboard__panel-heading">
            <div>
              <p className="eyebrow">WHAT’S NEXT</p>
              <h2 id="upcoming-events-title">Upcoming events</h2>
            </div>
            <Link className="admin-dashboard__text-link" to="/admin/events">View all <span aria-hidden="true">→</span></Link>
          </header>
          {dashboard.upcoming_events.length === 0 ? (
            <div className="admin-dashboard__empty">
              <p>No upcoming published events. Publish an event to feature it here.</p>
              <Link className="admin-dashboard__text-link" to="/admin/events" state={{ status: 'draft' }}>Review drafts <span aria-hidden="true">→</span></Link>
            </div>
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
                    <p>{event.venue} · <time dateTime={event.starts_at}>{formatEventDate(event.starts_at, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</time></p>
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
