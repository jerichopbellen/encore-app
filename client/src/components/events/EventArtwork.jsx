import { useState } from 'react'
import { formatEventDate } from '../../utils/eventDisplay'

const artworkPalettes = ['ink', 'blue', 'copper', 'moss']

function getPalette(id) {
  const hash = Array.from(String(id || 'encore')).reduce((total, character) => total + character.charCodeAt(0), 0)
  return artworkPalettes[hash % artworkPalettes.length]
}

// Shows the admin-uploaded poster when the event has one (or a local preview
// URL while an admin is choosing a file). Without one, or if the image fails to
// load, it renders Encore's generated default poster exactly as before.
function EventArtwork({ event, variant = 'card', posterUrl = event.poster_url }) {
  const [failedPosterUrl, setFailedPosterUrl] = useState(null)
  const date = formatEventDate(event.starts_at, { month: 'short', day: 'numeric' })

  if (posterUrl && posterUrl !== failedPosterUrl) {
    return (
      <div className={`event-artwork event-artwork--poster event-artwork--${variant}`}>
        <img
          className="event-artwork__poster"
          src={posterUrl}
          alt={`Event poster for ${event.title}, ${date}`}
          loading={variant === 'detail' ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFailedPosterUrl(posterUrl)}
        />
      </div>
    )
  }

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
