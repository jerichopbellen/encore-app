import { Link, useParams } from 'react-router'
import events from '../../data/events'

function EventDetails() {
  const { id } = useParams()
  const event = events.find((item) => item.id === id)

  if (!event) {
    return (
      <section className="event-not-found">
        <p className="eyebrow">NOT ON THE LINEUP</p>
        <h1>We can’t find that event.</h1>
        <p>It may have moved, or the link may be out of date.</p>
        <Link className="button-link" to="/">Back to all events</Link>
      </section>
    )
  }

  const eventDate = new Intl.DateTimeFormat('en-PH', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(event.date))

  return (
    <article className="event-details">
      <Link className="event-details__back" to="/">← All events</Link>
      <div className={`event-details__hero event-card__art--${event.accent}`}>
        <span className="event-card__category">{event.category}</span>
        <span className="event-details__hero-mark" aria-hidden="true">{event.category === 'Sports' ? '✦' : '♫'}</span>
        <span className="event-details__hero-artist">{event.artist}</span>
      </div>
      <div className="event-details__content">
        <div>
          <p className="eyebrow">{event.city} · {event.venue}</p>
          <h1>{event.title}</h1>
          <p className="event-details__date">{eventDate}</p>
          <p className="event-details__description">{event.description}</p>
        </div>
        <aside className="event-details__price">
          <p className="eyebrow">TICKETS</p>
          <p>From <strong>₱{event.price.toLocaleString('en-PH')}</strong></p>
          <span>Prices shown in Philippine pesos</span>
        </aside>
      </div>
    </article>
  )
}

export default EventDetails
