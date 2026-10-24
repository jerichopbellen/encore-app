import { useEffect, useState } from 'react'
import {
  createAdminTicketType,
  getAdminTicketTypes,
  updateAdminTicketType,
} from '../../services/adminEventsApi'
import { formatPrice } from '../../utils/eventDisplay'

const emptyDraft = { name: '', price: '', total_quantity: '' }

function normalizePrice(value) {
  if (String(value).trim() === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) ? Math.round(amount * 100) : null
}

function draftsMatch(left, right) {
  const leftQuantity = String(left.total_quantity).trim() === '' ? null : Number(left.total_quantity)
  const rightQuantity = String(right.total_quantity).trim() === '' ? null : Number(right.total_quantity)
  return left.name.trim() === right.name.trim()
    && normalizePrice(left.price) === normalizePrice(right.price)
    && leftQuantity === rightQuantity
}

function TicketTypeForm({ draft, setDraft, onSubmit, onCancel, isSaving, isEditing }) {
  return (
    <form className="admin-ticket-form" onSubmit={onSubmit}>
      <div className="admin-ticket-form__fields">
        <label>
          <span>Ticket name</span>
          <input
            value={draft.name}
            maxLength={100}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            required
          />
        </label>
        <label>
          <span>Price (PHP)</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={draft.price}
            onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))}
            required
          />
        </label>
        <label>
          <span>Total capacity</span>
          <input
            type="number"
            min="0"
            step="1"
            value={draft.total_quantity}
            onChange={(event) => setDraft((current) => ({ ...current, total_quantity: event.target.value }))}
            required
          />
        </label>
      </div>
      <p className="admin-ticket-form__help">
        Total capacity is the number of tickets offered. Available is what remains after active reservations and confirmed bookings.
        Reductions below committed tickets are rejected.
      </p>
      <div className="admin-ticket-form__actions">
        <button className="button-link" type="submit" disabled={isSaving}>
          {isSaving ? 'Saving…' : isEditing ? 'Save ticket type' : 'Add ticket type'}
        </button>
        <button className="admin-events__secondary" type="button" onClick={onCancel} disabled={isSaving}>Cancel</button>
      </div>
    </form>
  )
}

function TicketTypesManager({ eventId, onUnsavedChange = () => {}, onTicketTypesChange = () => {} }) {
  const [ticketTypes, setTicketTypes] = useState([])
  const [loadState, setLoadState] = useState('loading')
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [notice, setNotice] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [isSaving, setIsSaving] = useState(false)
  const [originalDraft, setOriginalDraft] = useState(emptyDraft)

  const isFormOpen = showCreateForm || Boolean(editingId)
  const isDirty = isFormOpen && !draftsMatch(draft, originalDraft)

  useEffect(() => {
    onUnsavedChange(isDirty)
  }, [isDirty, onUnsavedChange])

  // Lets the workspace keep its overview figures in step with ticket edits.
  useEffect(() => {
    if (loadState === 'success') onTicketTypesChange(ticketTypes)
  }, [loadState, ticketTypes, onTicketTypesChange])

  useEffect(() => {
    let isCurrent = true
    getAdminTicketTypes(eventId)
      .then((data) => {
        if (!isCurrent) return
        setTicketTypes(data)
        setLoadState('success')
      })
      .catch((error) => {
        if (isCurrent) {
          setLoadError(error.message)
          setLoadState('error')
        }
      })
    return () => { isCurrent = false }
  }, [eventId])

  function beginCreate() {
    setEditingId(null)
    setDraft(emptyDraft)
    setOriginalDraft(emptyDraft)
    setSaveError('')
    setNotice('')
    setShowCreateForm(true)
  }

  function beginEdit(ticketType) {
    setShowCreateForm(false)
    setEditingId(ticketType.id)
    setDraft({
      name: ticketType.name,
      price: ticketType.price,
      total_quantity: String(ticketType.total_quantity),
    })
    setOriginalDraft({
      name: ticketType.name,
      price: String(ticketType.price),
      total_quantity: String(ticketType.total_quantity),
    })
    setSaveError('')
    setNotice('')
  }

  function cancelForm() {
    if (isSaving) return
    if (isDirty && !window.confirm('Discard these ticket type changes?')) return
    setShowCreateForm(false)
    setEditingId(null)
    setDraft(emptyDraft)
    setOriginalDraft(emptyDraft)
    setSaveError('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (isSaving) return
    setIsSaving(true)
    setSaveError('')
    setNotice('')
    const input = {
      name: draft.name,
      price: draft.price,
      total_quantity: Number(draft.total_quantity),
    }

    try {
      const saved = editingId
        ? await updateAdminTicketType(eventId, editingId, input)
        : await createAdminTicketType(eventId, input)
      const nextTypes = editingId
        ? ticketTypes.map((ticketType) => ticketType.id === saved.id ? saved : ticketType)
        : [...ticketTypes, saved].sort((left, right) => left.name.localeCompare(right.name))
      setTicketTypes(nextTypes)
      setNotice(editingId ? 'Ticket type updated.' : 'Ticket type created.')
      setShowCreateForm(false)
      setEditingId(null)
      setDraft(emptyDraft)
      setOriginalDraft(emptyDraft)
    } catch (error) {
      setSaveError(error.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="admin-ticket-manager" aria-label="Manage event ticket types">
      <header className="admin-ticket-manager__heading">
        <div>
          <p className="eyebrow">INVENTORY</p>
          <h4>Ticket types</h4>
          <p>Total capacity and remaining availability are shown separately.</p>
        </div>
        <button className="admin-events__secondary" type="button" onClick={showCreateForm ? cancelForm : beginCreate} disabled={isSaving || Boolean(editingId)}>
          {showCreateForm ? 'Close form' : 'Add ticket type'}
        </button>
      </header>

      {isDirty && <p className="admin-form__unsaved" role="status">Unsaved ticket type changes</p>}

      {loadError && <p className="admin-ticket-manager__error" role="alert">{loadError}</p>}
      {saveError && <p className="admin-ticket-manager__error" role="alert">{saveError}</p>}
      {notice && <p className="admin-ticket-manager__notice" role="status">{notice}</p>}

      {showCreateForm && (
        <TicketTypeForm
          draft={draft}
          setDraft={setDraft}
          onSubmit={handleSubmit}
          onCancel={cancelForm}
          isSaving={isSaving}
          isEditing={false}
        />
      )}

      {loadState === 'loading' && <p className="admin-ticket-manager__state" role="status">Loading ticket types…</p>}
      {loadState === 'error' && <p className="admin-ticket-manager__state">Ticket types could not be loaded.</p>}
      {loadState === 'success' && ticketTypes.length === 0 && !showCreateForm && (
        <p className="admin-ticket-manager__state">No ticket types yet. Add one when this event is ready for ticket sales.</p>
      )}
      {loadState === 'success' && ticketTypes.length > 0 && (
        <div className="admin-ticket-list">
          {ticketTypes.map((ticketType) => (
            <article className="admin-ticket" key={ticketType.id}>
              {editingId === ticketType.id ? (
                <TicketTypeForm
                  draft={draft}
                  setDraft={setDraft}
                  onSubmit={handleSubmit}
                  onCancel={cancelForm}
                  isSaving={isSaving}
                  isEditing
                />
              ) : (
                <>
                  <div className="admin-ticket__identity">
                    <h5>{ticketType.name}</h5>
                    <span>{formatPrice(ticketType.price)}</span>
                  </div>
                  <dl className="admin-ticket__inventory">
                    <div><dt>Total capacity</dt><dd>{ticketType.total_quantity}</dd></div>
                    <div><dt>Available</dt><dd>{ticketType.available_quantity}</dd></div>
                  </dl>
                  <button className="admin-events__secondary" type="button" onClick={() => beginEdit(ticketType)} disabled={isSaving || showCreateForm}>Edit</button>
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export default TicketTypesManager
