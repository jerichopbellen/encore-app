import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { getAdminEvents, updateAdminEventStatus } from '../../services/adminEventsApi'
import { formatEventDate } from '../../utils/eventDisplay'
import EventArtwork from '../../components/events/EventArtwork'
import AdminEventActionsMenu from '../../components/admin/AdminEventActionsMenu'

const STATUS_FILTERS = [
  ['all', 'All'],
  ['published', 'Published'],
  ['draft', 'Drafts'],
]
// Events have only a start time, so an event is past once that time has passed.
const TIMING_FILTERS = [
  ['any', 'Any time'],
  ['upcoming', 'Upcoming'],
  ['past', 'Past'],
]
const SORT_OPTIONS = [
  ['soonest', 'Soonest first'],
  ['latest', 'Latest first'],
  ['title', 'Title A–Z'],
]

function sortEvents(events, sort) {
  return [...events].sort((left, right) => {
    if (sort === 'title') return left.title.localeCompare(right.title)
    const difference = new Date(left.starts_at) - new Date(right.starts_at)
    return sort === 'latest' ? -difference : difference
  })
}

function getEventTiming(event, now) {
  return new Date(event.starts_at) > now ? 'upcoming' : 'past'
}

function AdminEventsPage() {
  const location = useLocation()
  const [events, setEvents] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  // The dashboard's "Review drafts" link opens this page already filtered.
  const [statusFilter, setStatusFilter] = useState(() => (
    STATUS_FILTERS.some(([value]) => value === location.state?.status) ? location.state.status : 'all'
  ))
  const [timingFilter, setTimingFilter] = useState('any')
  const [sort, setSort] = useState('soonest')
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

  const now = new Date()
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase()
  const matchingEvents = events.filter((event) => !normalizedQuery
    || event.title.toLocaleLowerCase().includes(normalizedQuery)
    || event.venue.toLocaleLowerCase().includes(normalizedQuery))
  const statusCounts = {
    all: matchingEvents.length,
    published: matchingEvents.filter((event) => event.status === 'published').length,
    draft: matchingEvents.filter((event) => event.status === 'draft').length,
  }
  const timingCounts = {
    any: matchingEvents.length,
    upcoming: matchingEvents.filter((event) => getEventTiming(event, now) === 'upcoming').length,
    past: matchingEvents.filter((event) => getEventTiming(event, now) === 'past').length,
  }
  const visibleEvents = sortEvents(
    matchingEvents.filter((event) => (statusFilter === 'all' || event.status === statusFilter)
      && (timingFilter === 'any' || getEventTiming(event, now) === timingFilter)),
    sort,
  )
  const hasActiveFilters = Boolean(searchQuery.trim()) || statusFilter !== 'all' || timingFilter !== 'any'

  async function handleStatusChange(event) {
    const nextStatus = event.status === 'published' ? 'draft' : 'published'
    setPendingEventId(event.id)
    setErrorMessage('')
    setNotice('')
    try {
      const updatedEvent = await updateAdminEventStatus(event.id, nextStatus)
      setEvents((current) => current.map((item) => item.id === updatedEvent.id ? updatedEvent : item))
      setNotice(nextStatus === 'published' ? `${event.title} published.` : `${event.title} unpublished and returned to draft.`)
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
    setTimingFilter('any')
  }

  return (
    <section className="admin-events" aria-labelledby="admin-events-title">
      <header className="admin-events__heading">
        <div>
          <p className="eyebrow">ENCORE ADMIN</p>
          <h1 id="admin-events-title">Events</h1>
          <p>Find an event to update its details, ticket types, poster, or publication status.</p>
        </div>
        <div className="admin-dashboard__actions">
          <Link className="admin-events__secondary" to="/admin">Dashboard</Link>
          <Link className="button-link" to="/admin/events/new">Create event</Link>
        </div>
      </header>

      {errorMessage && loadState !== 'error' && <p className="admin-events__message admin-events__message--error" role="alert">{errorMessage}</p>}
      {notice && <p className="admin-events__message admin-events__message--success" role="status">{notice}</p>}

      <div className="admin-events__toolbar">
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
          {STATUS_FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={statusFilter === value ? 'admin-events__filter admin-events__filter--active' : 'admin-events__filter'}
              aria-pressed={statusFilter === value}
              onClick={() => setStatusFilter(value)}
            >
              {label}{loadState === 'success' && <span className="admin-events__filter-count">{statusCounts[value]}</span>}
            </button>
          ))}
        </div>
        <div className="admin-events__filters" role="group" aria-label="Filter events by upcoming or past">
          {TIMING_FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={timingFilter === value ? 'admin-events__filter admin-events__filter--active' : 'admin-events__filter'}
              aria-pressed={timingFilter === value}
              onClick={() => setTimingFilter(value)}
            >
              {label}{loadState === 'success' && <span className="admin-events__filter-count">{timingCounts[value]}</span>}
            </button>
          ))}
        </div>
        <label className="admin-events__sort">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      {loadState === 'success' && events.length > 0 && (
        <div className="admin-events__result-line">
          <span aria-live="polite">Showing {visibleEvents.length} of {events.length} {events.length === 1 ? 'event' : 'events'}</span>
          {hasActiveFilters && <button className="admin-events__clear" type="button" onClick={clearFilters}>Clear filters</button>}
        </div>
      )}

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
        <div className="admin-event-table" id="admin-event-results">
          <div className="admin-event-row admin-event-row--header" aria-hidden="true">
            <span />
            <span>Date</span>
            <span>Event</span>
            <span>Status</span>
            <span>Tickets</span>
            <span />
          </div>
          <ul className="admin-event-rows" aria-label="Events">
            {visibleEvents.map((event) => {
              const ticketTypeCount = event.ticket_types.length
              const timing = getEventTiming(event, now)
              return (
                <li className="admin-event-row" key={event.id}>
                  <Link className="admin-event-row__poster" to={`/admin/events/${event.id}`} tabIndex={-1} aria-hidden="true">
                    <EventArtwork event={event} />
                  </Link>
                  <div className="admin-event-row__date">
                    <time dateTime={event.starts_at}>{formatEventDate(event.starts_at, { month: 'short', day: '2-digit' })}</time>
                    <span>{formatEventDate(event.starts_at, { year: 'numeric' })} · {formatEventDate(event.starts_at, { hour: 'numeric', minute: '2-digit' })}</span>
                    <span className={`admin-event-timing admin-event-timing--${timing}`}>{timing === 'upcoming' ? 'Upcoming' : 'Past'}</span>
                  </div>
                  <div className="admin-event-row__event">
                    <h2><Link to={`/admin/events/${event.id}`}>{event.title}</Link></h2>
                    <p>{event.venue}</p>
                  </div>
                  <span className={`admin-event-badge admin-event-badge--${event.status}`}>{event.status === 'published' ? 'Published' : 'Draft'}</span>
                  <span className={ticketTypeCount === 0 ? 'admin-event-row__tickets admin-event-row__tickets--none' : 'admin-event-row__tickets'}>
                    {ticketTypeCount === 0 ? 'No tickets yet' : `${ticketTypeCount} ${ticketTypeCount === 1 ? 'type' : 'types'}`}
                  </span>
                  <div className="admin-event-row__actions">
                    <Link className="admin-event-row__manage" to={`/admin/events/${event.id}`} aria-label={`Manage ${event.title}`}>Manage</Link>
                    <AdminEventActionsMenu
                      event={event}
                      isSaving={pendingEventId === event.id}
                      onStatusChange={handleStatusChange}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}

export default AdminEventsPage
