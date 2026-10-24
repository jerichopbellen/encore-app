import { useEffect, useState } from 'react'
import EventPosterField from './EventPosterField'

const emptyDraft = { title: '', venue: '', starts_at: '', description: '' }

function toLocalDateTime(value) {
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function getDraft(event) {
  if (!event) return emptyDraft
  return {
    title: event.title,
    venue: event.venue,
    starts_at: toLocalDateTime(event.starts_at),
    description: event.description || '',
  }
}

function isFutureDateTime(value) {
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && timestamp > Date.now()
}

// A stand-in event so the poster preview matches the cards and banner as the admin types.
function getPreviewEvent(draft, initialEvent) {
  const startsAt = new Date(draft.starts_at)
  return {
    id: initialEvent?.id || 'new-event',
    title: draft.title.trim() || 'Untitled event',
    venue: draft.venue.trim() || 'Venue to be announced',
    starts_at: Number.isFinite(startsAt.getTime()) ? startsAt.toISOString() : new Date().toISOString(),
  }
}

function draftsMatch(left, right) {
  return left.title === right.title
    && left.venue === right.venue
    && left.starts_at === right.starts_at
    && left.description === right.description
}

function AdminEventForm({
  initialEvent,
  isSaving,
  errorMessage,
  onDirtyChange,
  onSubmit,
  onCancel,
  submitLabel,
  savingLabel = 'Saving…',
}) {
  const [draft, setDraft] = useState(() => getDraft(initialEvent))
  const [dateError, setDateError] = useState('')
  const [originalDraft] = useState(() => getDraft(initialEvent))
  const [posterChange, setPosterChange] = useState(null)
  // The poster the admin saw when the form opened. It is sent as the
  // replace/remove precondition so a newer poster is never overwritten silently.
  const [originalPoster] = useState(() => ({
    url: initialEvent?.poster_url || null,
    publicId: initialEvent?.poster_public_id || null,
  }))
  const isEditing = Boolean(initialEvent)
  const isDirty = !draftsMatch(draft, originalDraft) || posterChange !== null
  const minDateTime = isEditing && new Date(originalDraft.starts_at) <= new Date()
    ? originalDraft.starts_at
    : toLocalDateTime(new Date())

  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  function handleDateTimeChange(value) {
    setDraft((current) => ({ ...current, starts_at: value }))
    if (isEditing && value === originalDraft.starts_at) {
      setDateError('')
      return
    }
    setDateError(
      !value || !Number.isFinite(new Date(value).getTime())
        ? 'Choose a valid event date and time.'
        : !isFutureDateTime(value)
          ? 'Event start time must be in the future.'
          : '',
    )
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const startWasChanged = !isEditing || draft.starts_at !== originalDraft.starts_at
    const startsAt = new Date(draft.starts_at)
    if (startWasChanged && (!draft.starts_at || !Number.isFinite(startsAt.getTime()))) {
      setDateError('Choose a valid event date and time.')
      return
    }
    if (startWasChanged && !isFutureDateTime(draft.starts_at)) {
      setDateError('Event start time must be in the future.')
      return
    }

    setDateError('')
    const payload = {
      title: draft.title,
      venue: draft.venue,
      description: draft.description,
    }
    if (startWasChanged) payload.starts_at = startsAt.toISOString()
    await onSubmit(payload, posterChange && { ...posterChange, expectedPublicId: originalPoster.publicId })
  }

  return (
    <form className="admin-event-form" onSubmit={handleSubmit}>
      <div className="admin-event-form__heading">
        <div>
          <p className="eyebrow">{isEditing ? 'EVENT DETAILS' : 'NEW EVENT'}</p>
          <h2>{isEditing ? 'Edit event details' : 'Create an event'}</h2>
        </div>
        {isEditing
          ? <span className="admin-event-status">Current event · {initialEvent.status}</span>
          : <span className="admin-event-status admin-event-status--draft">New events start as drafts</span>}
      </div>
      {isDirty && <p className="admin-form__unsaved" role="status">Unsaved changes</p>}
      {errorMessage && <p className="admin-events__message admin-events__message--error" role="alert">{errorMessage}</p>}
      <div className="admin-event-form__fields">
        <label>
          <span>Event title</span>
          <input
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            maxLength={200}
            required
          />
        </label>
        <label>
          <span>Venue</span>
          <input
            value={draft.venue}
            onChange={(event) => setDraft((current) => ({ ...current, venue: event.target.value }))}
            maxLength={200}
            required
          />
        </label>
        <label>
          <span>Date and time</span>
          <input
            type="datetime-local"
            value={draft.starts_at}
            min={minDateTime}
            onChange={(event) => handleDateTimeChange(event.target.value)}
            aria-invalid={Boolean(dateError)}
            aria-describedby={dateError ? 'admin-event-date-error' : undefined}
            required
          />
          {dateError && <span className="admin-event-form__field-error" id="admin-event-date-error" role="alert">{dateError}</span>}
        </label>
        <label className="admin-event-form__description">
          <span>Description <small>(optional)</small></span>
          <textarea
            value={draft.description}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            rows={4}
          />
        </label>
      </div>
      <EventPosterField
        previewEvent={getPreviewEvent(draft, initialEvent)}
        currentPosterUrl={originalPoster.url}
        change={posterChange}
        onChange={setPosterChange}
        disabled={isSaving}
        isCreating={!isEditing}
      />
      <div className="admin-event-form__actions">
        <button className="button-link" type="submit" disabled={isSaving}>
          {isSaving ? savingLabel : submitLabel}
        </button>
        <button className="admin-events__secondary" type="button" onClick={onCancel} disabled={isSaving}>Cancel</button>
      </div>
    </form>
  )
}

export default AdminEventForm
