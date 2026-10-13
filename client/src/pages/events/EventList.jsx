
import { useEffect, useState } from 'react'
import EventCard from '../../components/events/EventCard'
import { getEvents } from '../../services/eventsApi'

function EventList() {
  const [loadState, setLoadState] = useState({ status: 'loading', events: [] })
  const [retryCount, setRetryCount] = useState(0)
  const events = loadState.events

  useEffect(() => {
    let isCurrentRequest = true

    getEvents()
      .then((data) => {
        if (isCurrentRequest) {
          setLoadState({ status: 'success', events: data })
        }
      })
      .catch((error) => {
        if (isCurrentRequest) {
          setLoadState({ status: 'error', events: [], message: error.message })
        }
      })

    return () => { isCurrentRequest = false }
  }, [retryCount])

  return (
    <div className="catalogue">
      <section className="catalogue__intro">
        <p className="eyebrow">MAKE TONIGHT A STORY</p>
        <h1>Find your next<br /><span>encore.</span></h1>
        <p className="catalogue__subtitle">Live music, big games, and the moments you’ll talk about tomorrow.</p>
      </section>
      <section className="catalogue__events" aria-label="Upcoming events">
        <div className="catalogue__heading">
          <div><p className="eyebrow">THE LINEUP</p><h2>Upcoming events</h2></div>
          {loadState.status === 'success' && (
            <span>{events.length} {events.length === 1 ? 'event' : 'events'}</span>
          )}
        </div>
        {loadState.status === 'loading' && (
          <p className="event-page-state" role="status">Loading events…</p>
        )}
        {loadState.status === 'error' && (
          <div className="event-page-state" role="alert">
            <p>{loadState.message}</p>
            <button className="button-link" type="button" onClick={() => {
              setLoadState({ status: 'loading', events: [] })
              setRetryCount((count) => count + 1)
            }}>
              Try again
            </button>
          </div>
        )}
        {loadState.status === 'success' && events.length === 0 && (
          <p className="event-page-state">There are no published events yet. Please check back soon.</p>
        )}
        {loadState.status === 'success' && events.length > 0 && (
          <div className="event-grid">
            {events.map((event) => <EventCard key={event.id} event={event} />)}
          </div>
        )}
      </section>
    </div>
  )
}

export default EventList
