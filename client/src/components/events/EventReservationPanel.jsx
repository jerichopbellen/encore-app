import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../contexts/AuthContext'
import { createReservation } from '../../services/reservationsApi'
import { formatPrice } from '../../utils/eventDisplay'

function EventReservationPanel({ event }) {
  const { user, isLoading } = useAuth()
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
  const total = ticketType && quantityIsValid
    ? formatPrice((Number(ticketType.price) * requestedQuantity).toFixed(2))
    : '—'

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
        <p className="event-page-state" role="status">Checking your account…</p>
      ) : !user ? (
        <div className="reservation-panel__signed-out">
          <p>Sign in to hold tickets for this event.</p>
          <Link className="button-link" to="/login">Log in to continue</Link>
        </div>
      ) : reservation ? (
        <div className="reservation-panel__success" role="status">
          <p className="reservation-panel__success-title">Tickets reserved</p>
          <p>
            {reservation.items[0].quantity} × {reservation.items[0].ticket_name} for {formatPrice(reservation.total_amount)}.
          </p>
          <p className="reservation-panel__expiry">
            Held until {new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(reservation.expires_at))}.
          </p>
          <Link to="/reservations">View my reservations</Link>
        </div>
      ) : event.ticket_types.length === 0 ? (
        <p className="event-page-state">No ticket types are listed for this event yet.</p>
      ) : (
        <form className="reservation-form" onSubmit={handleSubmit}>
          <label className="reservation-form__field">
            Ticket type
            <select
              value={ticketType?.id || ''}
              onChange={(changeEvent) => {
                setTicketTypeId(changeEvent.target.value)
                setQuantity('1')
                setErrorMessage('')
              }}
              required
            >
              {event.ticket_types.map((ticket) => (
                <option key={ticket.id} value={ticket.id}>
                  {ticket.name}{ticket.available_quantity === 0 ? ' — Sold out' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="reservation-form__field">
            Quantity
            <input
              type="number"
              name="quantity"
              min="1"
              max={ticketType?.available_quantity || undefined}
              step="1"
              value={quantity}
              onChange={(changeEvent) => {
                setQuantity(changeEvent.target.value)
                setErrorMessage('')
              }}
              required
            />
            {ticketType && (
              <span className="reservation-form__hint">
                {ticketType.available_quantity} available · {formatPrice(ticketType.price)} each
              </span>
            )}
          </label>
          <div className="reservation-summary" aria-live="polite">
            <span>Estimated total</span>
            <strong>{total}</strong>
          </div>
          {errorMessage && <p className="auth-form__error" role="alert">{errorMessage}</p>}
          <button
            className="button-link reservation-form__submit"
            type="submit"
            disabled={isSubmitting || !ticketType || ticketType.available_quantity < 1}
          >
            {isSubmitting ? 'Reserving…' : ticketType?.available_quantity ? 'Reserve tickets' : 'Sold out'}
          </button>
          <p className="reservation-form__fineprint">
            Your reservation temporarily holds inventory. Payment and checkout are not part of this step.
          </p>
        </form>
      )}
    </section>
  )
}

export default EventReservationPanel
