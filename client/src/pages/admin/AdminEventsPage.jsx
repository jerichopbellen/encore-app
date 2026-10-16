import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { getAdminEvents, updateAdminEventStatus } from '../../services/adminEventsApi'
import { formatEventDate } from '../../utils/eventDisplay'

function AdminEventsPage() {
  const location = useLocation()
  const [events, setEvents] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loadState, setLoadState] = useState('loading')
  const [retryCount, setRetryCount] = useState(0)
  const [pendingEventId, setPendingEventId] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [notice, setNotice] = useState(location.state?.notice || '')

  useEffect(() => {
    let isCurrentRequest = true
    getAdminEvents()
      .then((data) => {
        if (!isCurrentRequest) return
        setEvents(data)
        setLoadState('success')
      })
      .catch((error) => {
        if (!isCurrentRequest) return
        setErrorMessage(error.message)
        setLoadState('error')
      })
    return () => { isCurrentRequest = false }
  }, [retryCount])

  const normalizedQuery = searchQuery.trim().toLocaleLowerCase()
  const visibleEvents = events.filter((event) => {
    const matchesQuery = !normalizedQuery
      || event.title.toLocaleLowerCase().includes(normalizedQuery)
      || event.venue.toLocaleLowerCase().includes(normalizedQuery)
    return matchesQuery && (statusFilter === 'all' || event.status === statusFilter)
  })
  const hasActiveFilters = Boolean(searchQuery.trim()) || statusFilter !== 'all'

  async function handleStatusChange(event) {
    const nextStatus = event.status === 'published' ? 'draft' : 'published'
    setPendingEventId(event.id)
    setErrorMessage('')
    setNotice('')
    try {
      const updatedEvent = await updateAdminEventStatus(event.id, nextStatus)
      setEvents((current) => current.map((item) => item.id === updatedEvent.id ? updatedEvent : item))
      setNotice(nextStatus === 'published' ? 'Event published.' : 'Event unpublished and returned to draft.')
    } catch (error) {
      setErrorMessage(error.message)
    } finally {
      setPendingEventId(null)
    }
  }

  function retryLoading() {
    setErrorMessage('')
    setLoadState('loading')
    setRetryCount((count) => count + 1)
  }

  function clearFilters() {
    setSearchQuery('')
    setStatusFilter('all')
  }

  return (
    <section className="admin-events" aria-labelledby="admin-events-title">
      <header className="admin-events__heading">
        <div>
          <p className="eyebrow">ENCORE ADMIN</p>
          <h1 id="admin-events-title">Manage events</h1>
          <p>Find an event to update its details, ticket types, or publication status.</p>
        </div>
        <div className="admin-events__heading-actions">
          {loadState === 'success' && <span className="admin-events__total">{events.length} total {events.length === 1 ? 'event' : 'events'}</span>}
          <Link className="button-link" to="/admin/events/new">Create event</Link>
        </div>
      </header>

      {errorMessage && loadState !== 'error' && <p className="admin-events__message admin-events__message--error" role="alert">{errorMessage}</p>}
      {notice && <p className="admin-events__message admin-events__message--success" role="status">{notice}</p>}

      <section className="admin-events__workspace" aria-label="Event catalogue management">
        <div className="admin-events__list-heading">
          <div>
            <p className="eyebrow">CATALOGUE</p>
            <h2>All events</h2>
          </div>
          {loadState === 'success' && <span className="admin-events__result-count" aria-live="polite">Showing {visibleEvents.length} of {events.length}</span>}
        </div>

        <div className="admin-events__controls">
          <label className="admin-events__search">
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by event or venue"
              aria-label="Search events by title or venue"
              aria-controls="admin-event-results"
            />
          </label>
          <div className="admin-events__filters" role="group" aria-label="Filter events by publication status">
            {[
              ['all', 'All'],
              ['published', 'Published'],
              ['draft', 'Drafts'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={statusFilter === value ? 'admin-events__filter admin-events__filter--active' : 'admin-events__filter'}
                aria-pressed={statusFilter === value}
                onClick={() => setStatusFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {hasActiveFilters && <button className="admin-events__clear" type="button" onClick={clearFilters}>Clear filters</button>}
        </div>

        {loadState === 'loading' && <p className="admin-events-state" role="status">Loading events…</p>}
        {loadState === 'error' && (
          <div className="admin-events-state" role="alert">
            <p>Events could not be loaded. {errorMessage}</p>
            <button className="button-link" type="button" onClick={retryLoading}>Try again</button>
          </div>
        )}
        {loadState === 'success' && events.length === 0 && (
          <div className="admin-events-state">
            <h2>No events yet</h2>
            <p>Create an event to begin preparing the public lineup.</p>
            <Link className="button-link" to="/admin/events/new">Create an event</Link>
          </div>
        )}
        {loadState === 'success' && events.length > 0 && visibleEvents.length === 0 && (
          <div className="admin-events-state admin-events-state--filtered">
            <h3>No events match these filters</h3>
            <p>Try another search or clear the current filters to see your full event list.</p>
            <button className="admin-events__secondary" type="button" onClick={clearFilters}>Clear search and filters</button>
          </div>
        )}
        {loadState === 'success' && visibleEvents.length > 0 && (
          <div className="admin-event-list" id="admin-event-results" aria-label="Events">
            {visibleEvents.map((event) => (
              <article className="admin-event-card" key={event.id}>
                <div className="admin-event-card__summary">
                  <div className="admin-event-card__main">
                    <div className="admin-event-card__topline">
                      <span className={`admin-event-status admin-event-status--${event.status}`}>{event.status === 'published' ? 'Published' : 'Draft'}</span>
                      <time dateTime={event.starts_at}>{formatEventDate(event.starts_at, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
                    </div>
                    <h3><Link to={`/admin/events/${event.id}`}>{event.title}</Link></h3>
                    <p className="admin-event-card__venue">{event.venue}</p>
                    {event.description && <p className="admin-event-card__description">{event.description}</p>}
                    <p className="admin-event-card__tickets">{event.ticket_types.length} ticket {event.ticket_types.length === 1 ? 'type' : 'types'} configured</p>
                  </div>
                  <div className="admin-event-card__actions">
                    <Link className="admin-event-card__manage" to={`/admin/events/${event.id}`}>Manage event</Link>
                    {event.status === 'published' && <Link to={`/events/${event.id}`}>View public event</Link>}
                    <button className="admin-events__secondary" type="button" onClick={() => handleStatusChange(event)} disabled={pendingEventId === event.id}>
                      {pendingEventId === event.id ? 'Saving…' : event.status === 'published' ? 'Unpublish' : 'Publish'}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  )
}

export default AdminEventsPage
