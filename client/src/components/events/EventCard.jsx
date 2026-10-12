import { Link } from 'react-router'

function EventCard({ event }) {
  const eventDate = new Date(event.date)
  const dateLabel = new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(eventDate)

  return (
    <article className="event-card">
      <Link className={`event-card__art event-card__art--${event.accent}`} to={`/events/${event.id}`} aria-label={`View ${event.title}`}>
        <span className="event-card__category">{event.category}</span>
        <span className="event-card__art-mark" aria-hidden="true">{event.category === 'Sports' ? '✦' : '♫'}</span>
        <span className="event-card__art-name">{event.artist}</span>
      </Link>
      <div className="event-card__body">
        <p className="event-card__date">{dateLabel} <span>·</span> {event.city}</p>
        <h2><Link to={`/events/${event.id}`}>{event.title}</Link></h2>
        <div className="event-card__bottom">
          <span>{event.venue}</span>
          <span className="event-card__price">From ₱{event.price.toLocaleString('en-PH')}</span>
        </div>
      </div>
    </article>
  )
}

export default EventCard
