import { Link } from 'react-router'
import { formatEventDate, formatPrice, getStartingPrice } from '../../utils/eventDisplay'
import EventArtwork from './EventArtwork'

function EventCard({ event }) {
  const dateLabel = formatEventDate(event.starts_at, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  const startingPrice = getStartingPrice(event.ticket_types)
  const availableTickets = event.ticket_types.reduce((total, ticketType) => total + ticketType.available_quantity, 0)

  return (
    <article className="event-card">
      <Link className="event-card__art" to={`/events/${event.id}`} aria-label={`View ${event.title}`}>
        <EventArtwork event={event} />
      </Link>
      <div className="event-card__body">
        <p className="event-card__date"><time dateTime={event.starts_at}>{dateLabel}</time></p>
        <h2><Link to={`/events/${event.id}`}>{event.title}</Link></h2>
        <p className="event-card__venue">{event.venue}</p>
        <div className="event-card__meta">
          {startingPrice === null
            ? <span>No ticket types listed</span>
            : <span className="event-card__price">From {formatPrice(startingPrice)}</span>}
          <span className={availableTickets > 0 ? 'event-card__availability' : event.ticket_types.length ? 'event-card__availability event-card__availability--sold-out' : 'event-card__availability'}>
            {event.ticket_types.length === 0
              ? 'No tickets listed'
              : availableTickets > 0 ? `${availableTickets.toLocaleString()} tickets available` : 'Sold out'}
          </span>
        </div>
        <Link className="event-card__action" to={`/events/${event.id}`}>
          View event <span aria-hidden="true">→</span>
        </Link>
      </div>
    </article>
  )
}

export default EventCard
