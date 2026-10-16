import { useEffect, useState } from 'react'
import EventCard from '../../components/events/EventCard'
import { getEvents } from '../../services/eventsApi'

const PAGE_SIZE = 12
const defaultFilters = { search: '', availableOnly: false, sort: 'soonest' }

function EventList() {
  const [loadState, setLoadState] = useState({ status: 'loading', events: [], pagination: null })
  const [retryCount, setRetryCount] = useState(0)
  const [filters, setFilters] = useState(defaultFilters)
  const [searchDraft, setSearchDraft] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    let isCurrentRequest = true

    getEvents({
      page,
      pageSize: PAGE_SIZE,
      search: filters.search,
      availableOnly: filters.availableOnly,
      sort: filters.sort,
    })
      .then((result) => {
        if (isCurrentRequest) {
          setLoadState({ status: 'success', events: result.events, pagination: result.pagination })
        }
      })
      .catch((error) => {
        if (isCurrentRequest) {
          setLoadState({ status: 'error', events: [], pagination: null, message: error.message })
        }
      })

    return () => { isCurrentRequest = false }
  }, [filters, page, retryCount])

  const pagination = loadState.pagination
  const hasActiveFilters = Boolean(filters.search || filters.availableOnly || filters.sort !== 'soonest')
  const firstEventNumber = pagination?.total_events ? (page - 1) * PAGE_SIZE + 1 : 0
  const lastEventNumber = pagination ? Math.min(page * PAGE_SIZE, pagination.total_events) : 0

  function submitSearch(event) {
    event.preventDefault()
    setLoadState((current) => ({ ...current, status: 'loading' }))
    setFilters((current) => ({ ...current, search: searchDraft.trim() }))
    setPage(1)
  }

  function clearFilters() {
    setLoadState((current) => ({ ...current, status: 'loading' }))
    setFilters(defaultFilters)
    setSearchDraft('')
    setPage(1)
  }

  function updateFilter(nextFilters) {
    setLoadState((current) => ({ ...current, status: 'loading' }))
    setFilters(nextFilters)
    setPage(1)
  }

  function goToPage(nextPage) {
    setLoadState((current) => ({ ...current, status: 'loading' }))
    setPage(nextPage)
  }

  return (
    <div className="catalogue">
      <section className="catalogue__intro" aria-labelledby="discover-title">
        <div className="catalogue__hero-copy">
          <p className="eyebrow">LIVE STARTS HERE</p>
          <p className="catalogue__hero-note">MUSIC · SPORT · MOMENTS THAT STAY</p>
          <h1 id="discover-title">Find your next<br /><span>encore.</span></h1>
          <p className="catalogue__subtitle">Live music, big games, and the moments you’ll talk about tomorrow.</p>
          <a className="catalogue__hero-action" href="#catalogue-events">Explore events <span aria-hidden="true">↓</span></a>
        </div>
      </section>

      <section className="catalogue__events" id="catalogue-events" aria-label="Event catalogue">
        <div className="catalogue__heading">
          <div><p className="eyebrow">THE LINEUP</p><h2>Discover events</h2></div>
          {pagination && <span>{pagination.total_events.toLocaleString()} {pagination.total_events === 1 ? 'event' : 'events'}</span>}
        </div>

        <div className="catalogue-controls">
          <form className="catalogue-search" role="search" onSubmit={submitSearch}>
            <label htmlFor="event-search">Search events</label>
            <div className="catalogue-search__controls">
              <input
                id="event-search"
                type="search"
                value={searchDraft}
                maxLength={100}
                placeholder="Search titles or venues"
                onChange={(event) => setSearchDraft(event.target.value)}
              />
              <button className="button-link" type="submit">Search</button>
            </div>
          </form>
          <div className="catalogue-controls__options">
            <label className="catalogue-controls__sort" htmlFor="event-sort">
              Sort by
              <select id="event-sort" value={filters.sort} onChange={(event) => {
                updateFilter({ ...filters, sort: event.target.value })
              }}>
                <option value="soonest">Date: soonest</option>
                <option value="latest">Date: latest</option>
                <option value="recently-added">Recently added</option>
              </select>
            </label>
            <label className="catalogue-controls__available">
              <input
                type="checkbox"
                checked={filters.availableOnly}
                onChange={(event) => {
                  updateFilter({ ...filters, availableOnly: event.target.checked })
                }}
              />
              <span>Tickets available</span>
            </label>
          </div>
          {hasActiveFilters && <button className="catalogue-controls__clear" type="button" onClick={clearFilters}>Clear filters</button>}
        </div>

        {loadState.status === 'loading' && <p className="event-page-state" role="status">Loading events…</p>}
        {loadState.status === 'error' && (
          <div className="event-page-state" role="alert">
            <p>{loadState.message}</p>
            <button className="button-link" type="button" onClick={() => { setLoadState((current) => ({ ...current, status: 'loading' })); setRetryCount((count) => count + 1) }}>Try again</button>
          </div>
        )}
        {loadState.status === 'success' && loadState.events.length === 0 && (
          <div className="event-page-state catalogue__empty">
            <h3>{hasActiveFilters ? 'No matching events' : 'No events are listed yet'}</h3>
            <p>{hasActiveFilters
              ? 'Try a different search or clear your filters to see the full lineup.'
              : 'There are no published events yet. Please check back soon.'}</p>
            {hasActiveFilters && <button className="button-link" type="button" onClick={clearFilters}>Clear filters</button>}
          </div>
        )}
        {loadState.status === 'success' && loadState.events.length > 0 && (
          <>
            <div className="event-grid" id="event-results" aria-live="polite">
              {loadState.events.map((event) => <EventCard key={event.id} event={event} />)}
            </div>
            <div className="catalogue-pagination" aria-label="Event result pages">
              <span>Showing {firstEventNumber}–{lastEventNumber} of {pagination.total_events.toLocaleString()}</span>
              {pagination.total_pages > 1 && (
                <div className="catalogue-pagination__controls">
                  <button type="button" disabled={page <= 1 || loadState.status === 'loading'} onClick={() => goToPage(page - 1)}>Previous</button>
                  <span>Page {page} of {pagination.total_pages}</span>
                  <button type="button" disabled={page >= pagination.total_pages || loadState.status === 'loading'} onClick={() => goToPage(page + 1)}>Next</button>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

export default EventList
