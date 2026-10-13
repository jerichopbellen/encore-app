import { Link } from 'react-router'
import { formatEventDate, formatPrice, getStartingPrice } from '../../utils/eventDisplay'

function EventCard({ event }) {
  const dateLabel = formatEventDate(event.starts_at, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const startingPrice = getStartingPrice(event.ticket_types)

  return (
    <article className="event-card">
      <Link className="event-card__art event-card__art--violet" to={`/events/${event.id}`} aria-label={`View ${event.title}`}>
        <span className="event-card__category">Event</span>
        <span className="event-card__art-mark" aria-hidden="true">✦</span>
        <span className="event-card__art-name">{event.venue}</span>
      </Link>
      <div className="event-card__body">
        <p className="event-card__date">{dateLabel} <span>·</span> {event.venue}</p>
        <h2><Link to={`/events/${event.id}`}>{event.title}</Link></h2>
        <div className="event-card__bottom">
          {startingPrice === null
            ? <span>No ticket types listed</span>
            : <span className="event-card__price">From {formatPrice(startingPrice)}</span>}
        </div>
      </div>
    </article>
  )
}

export default EventCard
