import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { getEvent } from '../../services/eventsApi'
import { formatEventDate, formatPrice, getStartingPrice } from '../../utils/eventDisplay'
import EventReservationPanel from '../../components/events/EventReservationPanel'
import EventArtwork from '../../components/events/EventArtwork'
import useDocumentTitle from '../../hooks/useDocumentTitle'

function EventDetails() {
  const { id } = useParams()
  const [loadState, setLoadState] = useState({ id: null, status: 'loading' })
  const [retryCount, setRetryCount] = useState(0)
  const [startedEventId, setStartedEventId] = useState(null)
  const currentLoadState = loadState.id === id ? loadState : { status: 'loading' }
  const event = currentLoadState.event
  useDocumentTitle(currentLoadState.status === 'success' && event ? event.title : 'Event details')

  useEffect(() => {
    let isCurrentRequest = true
    let startTimer

    getEvent(id)
      .then((data) => {
        if (isCurrentRequest) {
          setLoadState({ id, status: 'success', event: data })

          const serverNow = Date.parse(data.server_now)
          const receivedAt = Date.now()
          const checkStartTime = () => {
            if (!isCurrentRequest) return
            const estimatedServerNow = Number.isFinite(serverNow)
              ? serverNow + (Date.now() - receivedAt)
              : Date.now()
            const timeUntilStart = new Date(data.starts_at).getTime() - estimatedServerNow
            if (timeUntilStart <= 0) {
              setStartedEventId(id)
              return
            }
            // Long-lived tabs recheck in safe timer-sized chunks until kickoff.
            startTimer = window.setTimeout(checkStartTime, Math.min(timeUntilStart, 2_147_000_000))
          }
          checkStartTime()
        }
      })
      .catch((error) => {
        if (isCurrentRequest) {
          setLoadState({
            id,
            status: error.status === 400 || error.status === 404 ? 'not-found' : 'error',
            message: error.message,
          })
        }
      })

    return () => {
      isCurrentRequest = false
      window.clearTimeout(startTimer)
    }
  }, [id, retryCount])

  if (currentLoadState.status === 'loading') {
    return <p className="event-page-state" role="status">Loading event details…</p>
  }

  if (currentLoadState.status === 'error') {
    return (
      <section className="event-not-found" role="alert">
        <p className="eyebrow">EVENT UNAVAILABLE</p>
        <h1>We couldn’t load this event.</h1>
        <p>{currentLoadState.message}</p>
        <button className="button-link" type="button" onClick={() => {
          setLoadState({ id, status: 'loading' })
          setRetryCount((count) => count + 1)
        }}>
          Try again
        </button>
        <Link className="event-details__back" to="/">← All events</Link>
      </section>
    )
  }

  if (currentLoadState.status === 'not-found' || !event) {
    return (
      <section className="event-not-found">
        <p className="eyebrow">NOT ON THE LINEUP</p>
        <h1>We can’t find that event.</h1>
        <p>This event may no longer be available.</p>
        <Link className="button-link" to="/">Back to all events</Link>
      </section>
    )
  }

  const eventDate = formatEventDate(event.starts_at, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
  const hasStarted = startedEventId === id
  const startingPrice = getStartingPrice(event.ticket_types)
  const ticketTypeCount = event.ticket_types.length

  return (
    <article className="event-details">
      <Link className="event-details__back" to="/">← All events</Link>

      <header className="event-hero">
        <EventArtwork event={event} variant="hero" />
        <div className="event-hero__info">
          <div>
            <p className="event-hero__venue">{event.venue}</p>
            <h1>{event.title}</h1>
          </div>
          <div className="event-hero__facts">
            <time dateTime={event.starts_at}>{eventDate}</time>
            <span>
              {startingPrice === null
                ? 'Ticket types are not listed yet'
                : `From ${formatPrice(startingPrice)} · ${ticketTypeCount} ticket ${ticketTypeCount === 1 ? 'type' : 'types'}`}
            </span>
          </div>
          {hasStarted
            ? <span className="event-hero__closed">Reservations closed</span>
            : ticketTypeCount > 0 && <a className="event-hero__cta" href="#event-booking">Get tickets <span aria-hidden="true">↓</span></a>}
        </div>
      </header>

      <div className="event-details__body">
        <div className="event-details__main">
          <section className="event-info-card" aria-labelledby="event-about-title">
            <p className="eyebrow">ABOUT</p>
            <h2 id="event-about-title">The event</h2>
            <p className="event-details__description">{event.description || 'No description provided.'}</p>
          </section>
          <section className="event-info-card" aria-labelledby="event-facts-title">
            <p className="eyebrow">DETAILS</p>
            <h2 id="event-facts-title">Good to know</h2>
            <dl className="event-facts">
              <div><dt>When</dt><dd><time dateTime={event.starts_at}>{eventDate}</time></dd></div>
              <div><dt>Where</dt><dd>{event.venue}</dd></div>
              <div><dt>Tickets</dt><dd>Prices are in Philippine pesos. Reserved tickets are held for 15 minutes while you check out.</dd></div>
            </dl>
          </section>
        </div>

        <div className="event-details__booking" id="event-booking">
          {hasStarted ? (
            <>
              <section className="event-started-notice" role="status" aria-labelledby="event-started-title">
                <p className="eyebrow">EVENT STARTED</p>
                <h2 id="event-started-title">Reservations are closed</h2>
                <p>This event has already started. You can still view its details and ticket information.</p>
              </section>
              {ticketTypeCount > 0 && (
                <section className="event-price-list" aria-labelledby="event-price-list-title">
                  <h2 id="event-price-list-title">Ticket prices</h2>
                  <ul>
                    {event.ticket_types.map((ticketType) => (
                      <li key={ticketType.id}>
                        <div>
                          <h3>{ticketType.name}</h3>
                          <p>{ticketType.available_quantity} of {ticketType.total_quantity} available</p>
                        </div>
                        <strong>{formatPrice(ticketType.price)}</strong>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : <EventReservationPanel key={event.id} event={event} />}
        </div>
      </div>
    </article>
  )
}

export default EventDetails
