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
  const currentLoadState = loadState.id === id ? loadState : { status: 'loading' }
  const event = currentLoadState.event
  useDocumentTitle(currentLoadState.status === 'success' && event ? event.title : 'Event details')

  useEffect(() => {
    let isCurrentRequest = true

    getEvent(id)
      .then((data) => {
        if (isCurrentRequest) {
          setLoadState({ id, status: 'success', event: data })
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

    return () => { isCurrentRequest = false }
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
  const startingPrice = getStartingPrice(event.ticket_types)

  return (
    <article className="event-details">
      <Link className="event-details__back" to="/">← All events</Link>
      <EventArtwork event={event} variant="detail" />
      <div className="event-details__content">
        <div>
          <p className="eyebrow">{event.venue}</p>
          <h1>{event.title}</h1>
          <p className="event-details__date">{eventDate}</p>
          {event.description
            ? <p className="event-details__description">{event.description}</p>
            : <p className="event-details__description">No description provided.</p>}
        </div>
        <aside className="event-details__price">
          <p className="eyebrow">TICKETS</p>
          {startingPrice === null
            ? <p>Ticket types are not listed yet.</p>
            : <p>From <strong>{formatPrice(startingPrice)}</strong></p>}
          <span>Prices shown in Philippine pesos</span>
        </aside>
      </div>
      <section className="event-ticket-types" aria-label="Ticket types">
        <h2>Ticket options</h2>
        {event.ticket_types.length === 0
          ? <p className="event-page-state">No ticket types are listed for this event yet.</p>
          : <ul className="event-ticket-list">
            {event.ticket_types.map((ticketType) => (
              <li className="event-ticket" key={ticketType.id}>
                <div>
                  <h3>{ticketType.name}</h3>
                  <p>{ticketType.available_quantity} of {ticketType.total_quantity} available</p>
                </div>
                <strong>{formatPrice(ticketType.price)}</strong>
              </li>
            ))}
          </ul>}
      </section>
      <EventReservationPanel key={event.id} event={event} />
    </article>
  )
}

export default EventDetails
