import { useState } from 'react'
import { formatEventDate } from '../../utils/eventDisplay'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function describeStart(startsAt, now) {
  const remaining = new Date(startsAt).getTime() - now
  if (remaining <= 0) return { label: 'Started', value: 'Past' }
  if (remaining >= DAY) {
    const days = Math.floor(remaining / DAY)
    return { label: 'Starts in', value: `${days} ${days === 1 ? 'day' : 'days'}` }
  }
  return { label: 'Starts in', value: `${Math.max(1, Math.round(remaining / HOUR))} hr` }
}

// The workspace's landing tab: headline figures plus a readiness checklist whose
// open items jump straight to the tab (or action) that resolves them.
function AdminEventOverview({ event, ticketTypes, onOpenTab, onEditDetails, onStatusChange, isStatusPending, isStatusBlocked }) {
  // Captured once so the countdown stays stable while the admin works on the page.
  const [now] = useState(() => Date.now())
  const capacity = ticketTypes.reduce((total, ticketType) => total + ticketType.total_quantity, 0)
  const available = ticketTypes.reduce((total, ticketType) => total + ticketType.available_quantity, 0)
  const start = describeStart(event.starts_at, now)
  const hasTickets = ticketTypes.length > 0 && capacity > 0

  const checklist = [
    {
      label: 'Event details',
      done: Boolean(event.description),
      detail: event.description ? 'Title, venue, date, and description are set.' : 'Add a description so guests know what to expect.',
      action: !event.description && <button type="button" onClick={onEditDetails}>Add a description</button>,
    },
    {
      label: 'Ticket types',
      done: hasTickets,
      detail: hasTickets
        ? `${ticketTypes.length} ${ticketTypes.length === 1 ? 'type' : 'types'} with ${capacity.toLocaleString()} total capacity.`
        : 'Guests cannot reserve until at least one ticket type has capacity.',
      action: !hasTickets && <button type="button" onClick={() => onOpenTab('tickets')}>Add ticket types</button>,
    },
    {
      label: 'Poster',
      done: Boolean(event.poster_url),
      optional: true,
      detail: event.poster_url ? 'A custom poster is shown on Discover and the event page.' : 'Optional. The generated Encore poster is shown for now.',
      action: !event.poster_url && <button type="button" onClick={() => onOpenTab('poster')}>Add a poster</button>,
    },
    {
      label: 'Visibility',
      done: event.status === 'published',
      detail: event.status === 'published' ? 'Published and visible on Discover.' : 'Draft. Customers cannot see this event yet.',
      action: event.status !== 'published' && (
        <button type="button" onClick={onStatusChange} disabled={isStatusPending || isStatusBlocked}>
          {isStatusPending ? 'Publishing…' : 'Publish event'}
        </button>
      ),
    },
  ]

  return (
    <div className="admin-event-overview">
      <dl className="admin-event-overview__figures">
        <div>
          <dt>Tickets taken</dt>
          <dd className="admin-event-overview__value">{(capacity - available).toLocaleString()}</dd>
          <dd>of {capacity.toLocaleString()} capacity, sold or on hold</dd>
        </div>
        <div>
          <dt>Available</dt>
          <dd className="admin-event-overview__value">{available.toLocaleString()}</dd>
          <dd>across {ticketTypes.length} ticket {ticketTypes.length === 1 ? 'type' : 'types'}</dd>
        </div>
        <div>
          <dt>{start.label}</dt>
          <dd className="admin-event-overview__value">{start.value}</dd>
          <dd>{formatEventDate(event.starts_at, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</dd>
        </div>
      </dl>

      <section className="admin-event-overview__checklist" aria-labelledby="admin-event-checklist-title">
        <p className="eyebrow">READINESS</p>
        <h2 id="admin-event-checklist-title">Checklist</h2>
        <ul>
          {checklist.map((item) => (
            <li key={item.label} className={item.done ? 'admin-event-check admin-event-check--done' : 'admin-event-check'}>
              <span className="admin-event-check__mark" aria-hidden="true">{item.done ? '✓' : item.optional ? '○' : '!'}</span>
              <div>
                <strong>{item.label}<span className="sr-only">{item.done ? ': complete' : item.optional ? ': optional' : ': needs attention'}</span></strong>
                <p>{item.detail}</p>
              </div>
              {item.action && <div className="admin-event-check__action">{item.action}</div>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export default AdminEventOverview
