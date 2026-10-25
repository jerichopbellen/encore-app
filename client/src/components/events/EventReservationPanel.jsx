import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../contexts/AuthContext'
import AuthSessionNotice from '../auth/AuthSessionNotice'
import { createReservation } from '../../services/reservationsApi'
import { formatPrice } from '../../utils/eventDisplay'

// Ticket types at or below this many remaining are flagged as nearly gone.
const LOW_STOCK_THRESHOLD = 10

function describeAvailability(ticket) {
  if (ticket.available_quantity === 0) return 'Sold out'
  if (ticket.available_quantity <= LOW_STOCK_THRESHOLD) return `Only ${ticket.available_quantity} left`
  return `${ticket.available_quantity} of ${ticket.total_quantity} left`
}

function EventReservationPanel({ event }) {
  const { user, authStatus, isLoading } = useAuth()
  const [ticketTypeId, setTicketTypeId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [reservation, setReservation] = useState(null)

  const ticketType = event.ticket_types.find((ticket) => ticket.id === ticketTypeId)
    || event.ticket_types.find((ticket) => ticket.available_quantity > 0)
    || event.ticket_types[0]
    || null
  const requestedQuantity = Number(quantity)
  const quantityIsValid = Number.isSafeInteger(requestedQuantity) && requestedQuantity > 0
  const isSoldOut = !ticketType || ticketType.available_quantity < 1
  const total = ticketType && quantityIsValid
    ? formatPrice((Number(ticketType.price) * requestedQuantity).toFixed(2))
    : '—'

  function selectTicketType(id) {
    setTicketTypeId(id)
    setQuantity('1')
    setErrorMessage('')
  }

  // The stepper keeps the quantity within 1 and the selected type's availability.
  function changeQuantity(step) {
    const current = quantityIsValid ? requestedQuantity : 1
    const maximum = Math.max(1, ticketType?.available_quantity || 1)
    setQuantity(String(Math.min(maximum, Math.max(1, current + step))))
    setErrorMessage('')
  }

  async function handleSubmit(submitEvent) {
    submitEvent.preventDefault()
    setErrorMessage('')

    if (!ticketType) {
      setErrorMessage('There are no ticket types available for this event.')
      return
    }
    if (!quantityIsValid) {
      setErrorMessage('Enter a whole number of tickets greater than zero.')
      return
    }
    if (requestedQuantity > ticketType.available_quantity) {
      setErrorMessage(`Only ${ticketType.available_quantity} tickets are currently available.`)
      return
    }

    setIsSubmitting(true)
    try {
      const data = await createReservation({
        event_id: event.id,
        ticket_type_id: ticketType.id,
        quantity: requestedQuantity,
      })
      setReservation(data.reservation)
    } catch (error) {
      setErrorMessage(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const canReserve = Boolean(user) && authStatus !== 'error'

  return (
    <section className="reservation-panel" aria-labelledby="reservation-panel-title">
      <div className="reservation-panel__heading">
        <div>
          <p className="eyebrow">YOUR TICKETS</p>
          <h2 id="reservation-panel-title">Reserve tickets</h2>
        </div>
        <span className="reservation-panel__hold">15 minute hold</span>
      </div>

      {isLoading ? (
        <p className="reservation-panel__message" role="status">Checking your account…</p>
      ) : authStatus === 'error' ? (
        <AuthSessionNotice compact />
      ) : reservation ? (
        <div className="reservation-panel__success" role="status">
          <span className="reservation-panel__success-mark" aria-hidden="true">✓</span>
          <div>
            <p className="reservation-panel__success-title">Tickets reserved</p>
            <p>
              {reservation.items[0].quantity} × {reservation.items[0].ticket_name} for {formatPrice(reservation.total_amount)}.
            </p>
            <p className="reservation-panel__expiry">
              Held until {new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(reservation.expires_at))}.
            </p>
            <div className="reservation-panel__next">
              <Link className="button-link" to={`/reservations/${reservation.id}/checkout`}>Go to checkout</Link>
              <Link to="/account/reservations">View my reservations</Link>
            </div>
          </div>
        </div>
      ) : event.ticket_types.length === 0 ? (
        <p className="reservation-panel__message">No ticket types are listed for this event yet.</p>
      ) : (
        <form className="reservation-form" onSubmit={handleSubmit}>
          <fieldset className="reservation-tickets">
            <legend>Ticket type</legend>
            {event.ticket_types.map((ticket) => {
              const isSelected = ticket.id === ticketType?.id
              const isUnavailable = ticket.available_quantity === 0
              const className = [
                'reservation-ticket',
                isSelected && 'reservation-ticket--selected',
                isUnavailable && 'reservation-ticket--sold-out',
              ].filter(Boolean).join(' ')
              return (
                <label className={className} key={ticket.id}>
                  <input
                    type="radio"
                    name="reservation-ticket-type"
                    value={ticket.id}
                    checked={isSelected}
                    disabled={isUnavailable}
                    onChange={() => selectTicketType(ticket.id)}
                    aria-labelledby={`reservation-ticket-${ticket.id}-name`}
                    aria-describedby={`reservation-ticket-${ticket.id}-detail`}
                  />
                  <span className="reservation-ticket__text">
                    <span className="reservation-ticket__name" id={`reservation-ticket-${ticket.id}-name`}>{ticket.name}</span>
                    <span
                      className={ticket.available_quantity <= LOW_STOCK_THRESHOLD ? 'reservation-ticket__stock reservation-ticket__stock--low' : 'reservation-ticket__stock'}
                      id={`reservation-ticket-${ticket.id}-detail`}
                    >
                      {describeAvailability(ticket)}<span className="sr-only">, {formatPrice(ticket.price)} each</span>
                    </span>
                  </span>
                  <strong className="reservation-ticket__price" aria-hidden="true">{formatPrice(ticket.price)}</strong>
                </label>
              )
            })}
          </fieldset>

          <div className="reservation-form__quantity">
            <label htmlFor="reservation-quantity">Quantity</label>
            <div className="reservation-stepper">
              <button type="button" onClick={() => changeQuantity(-1)} disabled={isSoldOut || requestedQuantity <= 1} aria-label="Remove one ticket">−</button>
              <input
                id="reservation-quantity"
                type="number"
                name="quantity"
                min="1"
                max={ticketType?.available_quantity || undefined}
                step="1"
                inputMode="numeric"
                value={quantity}
                onChange={(changeEvent) => {
                  setQuantity(changeEvent.target.value)
                  setErrorMessage('')
                }}
                disabled={isSoldOut}
                required
              />
              <button type="button" onClick={() => changeQuantity(1)} disabled={isSoldOut || requestedQuantity >= (ticketType?.available_quantity || 1)} aria-label="Add one ticket">+</button>
            </div>
            <div className="reservation-summary" aria-live="polite">
              <span>Total</span>
              <strong>{total}</strong>
            </div>
          </div>

          {canReserve ? (
            <button className="button-link reservation-form__submit" type="submit" disabled={isSubmitting || isSoldOut}>
              {isSubmitting ? 'Reserving…' : isSoldOut ? 'Sold out' : 'Reserve tickets'}
            </button>
          ) : (
            <div className="reservation-panel__signed-out">
              <Link className="button-link reservation-form__submit" to="/login">Log in to reserve</Link>
              <p>You need an Encore account to hold tickets.</p>
            </div>
          )}
          {errorMessage && <p className="reservation-panel__error" role="alert">{errorMessage}</p>}
        </form>
      )}

      <p className="reservation-panel__note">
        <span className="reservation-panel__note-mark" aria-hidden="true">◷</span>
        <span><strong>Temporary 15-minute hold.</strong> Reserving holds your tickets; complete checkout before the hold expires to confirm your booking.</span>
      </p>
    </section>
  )
}

export default EventReservationPanel
