import { formatEventDate } from '../../utils/eventDisplay'

const artworkPalettes = ['ink', 'blue', 'copper', 'moss']

function getPalette(id) {
  const hash = Array.from(String(id || 'encore')).reduce((total, character) => total + character.charCodeAt(0), 0)
  return artworkPalettes[hash % artworkPalettes.length]
}

function EventArtwork({ event, variant = 'card' }) {
  const date = formatEventDate(event.starts_at, { month: 'short', day: 'numeric' })
  return (
    <div
      className={`event-artwork event-artwork--${getPalette(event.id)} event-artwork--${variant}`}
      role="img"
      aria-label={`Encore event artwork for ${event.title}, ${date}`}
    >
      <span className="event-artwork__kicker">ENCORE <span aria-hidden="true">/</span> LIVE</span>
      <span className="event-artwork__title">{event.title}</span>
      <span className="event-artwork__date">{date} <span aria-hidden="true">·</span> {event.venue}</span>
    </div>
  )
}

export default EventArtwork
