import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router'
import TicketTypesManager from '../../components/admin/TicketTypesManager'
import { useAuth } from '../../contexts/AuthContext'
import {
  createAdminEvent,
  getAdminEvents,
  updateAdminEvent,
  updateAdminEventStatus,
} from '../../services/adminEventsApi'
import { formatEventDate } from '../../utils/eventDisplay'

const emptyDraft = { title: '', venue: '', starts_at: '', description: '' }

function toLocalDateTime(value) {
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function isFutureDateTime(value) {
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && timestamp > Date.now()
}

function EventEditorForm({
  draft,
  setDraft,
  onSubmit,
  onCancel,
  onDateTimeChange,
  isSaving,
  isEditing,
  minDateTime,
  dateError,
  formRef,
  formId,
}) {
  return (
    <form className="admin-event-form" id={formId} onSubmit={onSubmit} ref={formRef}>
      <div className="admin-event-form__heading">
        <div>
          <p className="eyebrow">{isEditing ? 'EVENT DETAILS' : 'NEW EVENT'}</p>
          <h2>{isEditing ? 'Edit event' : 'Create an event'}</h2>
        </div>
        {!isEditing && <span className="admin-event-status admin-event-status--draft">New events start as drafts</span>}
      </div>
      <div className="admin-event-form__fields">
        <label>
          <span>Event title</span>
          <input value={draft.title} onChange={(e) => setDraft((current) => ({ ...current, title: e.target.value }))} maxLength={200} required />
        </label>
        <label>
          <span>Venue</span>
          <input value={draft.venue} onChange={(e) => setDraft((current) => ({ ...current, venue: e.target.value }))} maxLength={200} required />
        </label>
        <label>
          <span>Date and time</span>
          <input
            type="datetime-local"
            value={draft.starts_at}
            min={minDateTime}
            onChange={(e) => onDateTimeChange(e.target.value)}
            aria-invalid={Boolean(dateError)}
            aria-describedby={dateError ? 'admin-event-date-error' : undefined}
            required
          />
          {dateError && <span className="admin-event-form__field-error" id="admin-event-date-error" role="alert">{dateError}</span>}
        </label>
        <label className="admin-event-form__description">
          <span>Description <small>(optional)</small></span>
          <textarea value={draft.description} onChange={(e) => setDraft((current) => ({ ...current, description: e.target.value }))} rows={4} />
        </label>
      </div>
      <div className="admin-event-form__actions">
        <button className="button-link" type="submit" disabled={isSaving}>{isSaving ? 'Saving…' : isEditing ? 'Save changes' : 'Create draft'}</button>
        <button className="admin-events__secondary" type="button" onClick={onCancel} disabled={isSaving}>Cancel</button>
      </div>
    </form>
  )
}

function AdminEventsPage() {
  const { user, isLoading: isAuthLoading } = useAuth()
  const [events, setEvents] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loadState, setLoadState] = useState('loading')
  const [retryCount, setRetryCount] = useState(0)
  const [editingEventId, setEditingEventId] = useState(null)
  const [originalEditDateTime, setOriginalEditDateTime] = useState(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [draft, setDraft] = useState(emptyDraft)
  const [dateError, setDateError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const submissionLock = useRef(false)
  const editingFormRef = useRef(null)
  const [pendingEventId, setPendingEventId] = useState(null)
  const [ticketTypesEventId, setTicketTypesEventId] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [notice, setNotice] = useState('')

  const normalizedQuery = searchQuery.trim().toLocaleLowerCase()
  const visibleEvents = events.filter((event) => {
    const matchesQuery = !normalizedQuery
      || event.title.toLocaleLowerCase().includes(normalizedQuery)
      || event.venue.toLocaleLowerCase().includes(normalizedQuery)
    return matchesQuery && (statusFilter === 'all' || event.status === statusFilter)
  })
  const hasActiveFilters = Boolean(searchQuery.trim()) || statusFilter !== 'all'

  const handleTicketTypesChange = useCallback((eventId, ticketTypes) => {
    setEvents((current) => current.map((event) => (
      event.id === eventId ? { ...event, ticket_types: ticketTypes } : event
    )))
  }, [])

  useEffect(() => {
    if (isAuthLoading || user?.role !== 'admin') return undefined
    let isCurrentRequest = true
    getAdminEvents()
      .then((data) => {
        if (isCurrentRequest) {
          setEvents(data)
          setLoadState('success')
        }
      })
      .catch((error) => {
        if (isCurrentRequest) {
          setErrorMessage(error.message)
          setLoadState('error')
        }
      })
    return () => { isCurrentRequest = false }
  }, [isAuthLoading, retryCount, user])

  useEffect(() => {
    if (!editingEventId || !editingFormRef.current) return
    editingFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    editingFormRef.current.querySelector('input')?.focus({ preventScroll: true })
  }, [editingEventId])

  if (isAuthLoading) return <p className="admin-events-state" role="status">Checking your session…</p>
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') {
    return (
      <section className="admin-events-state" role="alert">
        <p className="eyebrow">ADMIN ACCESS</p>
        <h1>Administrator access is required.</h1>
        <p>Your account does not have permission to manage events.</p>
        <Link className="button-link" to="/">Back to events</Link>
      </section>
    )
  }

  function beginCreate() {
    setEditingEventId(null)
    setOriginalEditDateTime(null)
    setDateError('')
    setDraft(emptyDraft)
    setErrorMessage('')
    setNotice('')
    setIsFormOpen(true)
  }

  function beginEdit(event) {
    const startsAt = toLocalDateTime(event.starts_at)
    setEditingEventId(event.id)
    setOriginalEditDateTime(startsAt)
    setDateError('')
    setDraft({
      title: event.title,
      venue: event.venue,
      starts_at: startsAt,
      description: event.description || '',
    })
    setErrorMessage('')
    setNotice('')
    setIsFormOpen(true)
  }

  function closeForm() {
    if (isSaving) return
    setIsFormOpen(false)
    setEditingEventId(null)
    setOriginalEditDateTime(null)
    setDraft(emptyDraft)
    setDateError('')
    setErrorMessage('')
  }

  function handleDateTimeChange(value) {
    setDraft((current) => ({ ...current, starts_at: value }))
    if (editingEventId && value === originalEditDateTime) {
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
    if (submissionLock.current) return
    setErrorMessage('')
    setNotice('')
    const startsAt = new Date(draft.starts_at)
    const startWasChanged = !editingEventId || draft.starts_at !== originalEditDateTime
    if (startWasChanged) {
      if (!draft.starts_at || Number.isNaN(startsAt.getTime())) {
        setDateError('Choose a valid event date and time.')
        return
      }
      if (!isFutureDateTime(draft.starts_at)) {
        setDateError('Event start time must be in the future.')
        return
      }
    }
    setDateError('')

    const payload = {
      title: draft.title,
      venue: draft.venue,
      description: draft.description,
    }
    if (startWasChanged) payload.starts_at = startsAt.toISOString()
    submissionLock.current = true
    setIsSaving(true)
    try {
      const savedEvent = editingEventId
        ? await updateAdminEvent(editingEventId, payload)
        : await createAdminEvent(payload)
      setLoadState('success')
      setIsFormOpen(false)
      setEditingEventId(null)
      setOriginalEditDateTime(null)
      setDraft(emptyDraft)
      setDateError('')
      setNotice(editingEventId ? 'Event details saved.' : 'Event created as a draft.')
      if (!editingEventId || !matchesEventFilters(savedEvent, normalizedQuery, statusFilter)) {
        setSearchQuery('')
        setStatusFilter('all')
      }
      setEvents((current) => {
        const exists = current.some((item) => item.id === savedEvent.id)
        return exists
          ? current.map((item) => item.id === savedEvent.id ? savedEvent : item)
          : [...current, savedEvent].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
      })
    } catch (error) {
      setErrorMessage(error.message)
    } finally {
      submissionLock.current = false
      setIsSaving(false)
    }
  }

  async function handleStatusChange(event) {
    const nextStatus = event.status === 'published' ? 'draft' : 'published'
    setPendingEventId(event.id)
    setErrorMessage('')
    setNotice('')
    try {
      const updatedEvent = await updateAdminEventStatus(event.id, nextStatus)
      setEvents((current) => current.map((item) => item.id === updatedEvent.id ? updatedEvent : item))
      setNotice(nextStatus === 'published' ? 'Event published.' : 'Event unpublished and returned to draft.')
    } catch (error) {
      setErrorMessage(error.message)
    } finally {
      setPendingEventId(null)
    }
  }

  function retryLoading() {
    setErrorMessage('')
    setLoadState('loading')
    setRetryCount((count) => count + 1)
  }

  function matchesEventFilters(event, query, filter) {
    const matchesQuery = !query
      || event.title.toLocaleLowerCase().includes(query)
      || event.venue.toLocaleLowerCase().includes(query)
    return matchesQuery && (filter === 'all' || event.status === filter)
  }

  return (
    <section className="admin-events" aria-labelledby="admin-events-title">
      <header className="admin-events__heading">
        <div>
          <p className="eyebrow">ENCORE ADMIN</p>
          <h1 id="admin-events-title">Manage events</h1>
          <p>Update event details and manage what appears in the public lineup.</p>
        </div>
        <div className="admin-events__heading-actions">
          {loadState === 'success' && <span className="admin-events__total">{events.length} total {events.length === 1 ? 'event' : 'events'}</span>}
          <button
            className="button-link"
            type="button"
            onClick={() => (isFormOpen && !editingEventId ? closeForm() : beginCreate())}
            disabled={isSaving || Boolean(editingEventId) || Boolean(ticketTypesEventId)}
            aria-expanded={isFormOpen && !editingEventId}
            aria-controls="admin-event-create-form"
          >
            {editingEventId ? 'Finish editing first' : isFormOpen ? 'Close form' : 'Create event'}
          </button>
        </div>
      </header>

      {errorMessage && loadState !== 'error' && <p className="admin-events__message admin-events__message--error" role="alert">{errorMessage}</p>}
      {notice && <p className="admin-events__message admin-events__message--success" role="status">{notice}</p>}

      {isFormOpen && !editingEventId && (
        <EventEditorForm
          draft={draft}
          setDraft={setDraft}
          onSubmit={handleSubmit}
          onCancel={closeForm}
          onDateTimeChange={handleDateTimeChange}
          isSaving={isSaving}
          isEditing={false}
          minDateTime={toLocalDateTime(new Date())}
          dateError={dateError}
          formId="admin-event-create-form"
        />
      )}

      <section className="admin-events__workspace" aria-label="Event catalogue management">
        <div className="admin-events__list-heading">
          <div>
            <p className="eyebrow">CATALOGUE</p>
            <h2>All events</h2>
          </div>
          {loadState === 'success' && <span className="admin-events__result-count" aria-live="polite">Showing {visibleEvents.length} of {events.length}</span>}
        </div>

        <div className="admin-events__controls">
          <label className="admin-events__search">
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by event or venue"
              aria-label="Search events by title or venue"
              disabled={isSaving || Boolean(editingEventId)}
              aria-controls="admin-event-results"
            />
          </label>
          <div className="admin-events__filters" role="group" aria-label="Filter events by publication status">
            {[
              ['all', 'All'],
              ['published', 'Published'],
              ['draft', 'Drafts'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={statusFilter === value ? 'admin-events__filter admin-events__filter--active' : 'admin-events__filter'}
                aria-pressed={statusFilter === value}
                onClick={() => setStatusFilter(value)}
                disabled={isSaving || Boolean(editingEventId)}
              >
                {label}
              </button>
            ))}
          </div>
          {hasActiveFilters && (
            <button className="admin-events__clear" type="button" onClick={() => { setSearchQuery(''); setStatusFilter('all') }} disabled={isSaving || Boolean(editingEventId)}>
              Clear filters
            </button>
          )}
        </div>

        {loadState === 'success' && events.length > 0 && visibleEvents.length === 0 && (
          <div className="admin-events-state admin-events-state--filtered">
            <h3>No events match these filters</h3>
            <p>Try another search or clear the current filters to see your full event list.</p>
            <button className="admin-events__secondary" type="button" onClick={() => { setSearchQuery(''); setStatusFilter('all') }}>Clear search and filters</button>
          </div>
        )}

        {loadState === 'success' && events.length === 0 && (
          <div className="admin-events-state">
            <h2>No events yet</h2>
            <p>Create an event to begin preparing the public lineup.</p>
            <button className="button-link" type="button" onClick={beginCreate}>Create an event</button>
          </div>
        )}

        {loadState === 'success' && visibleEvents.length > 0 && (
          <div className="admin-event-list" id="admin-event-results" aria-label="Events">
            {visibleEvents.map((event) => (
              <article className={`admin-event-card${editingEventId === event.id ? ' admin-event-card--editing' : ''}`} key={event.id}>
                <div className="admin-event-card__summary">
                  <div className="admin-event-card__main">
                    <div className="admin-event-card__topline">
                      <span className={`admin-event-status admin-event-status--${event.status}`}>{event.status === 'published' ? 'Published' : 'Draft'}</span>
                      <time dateTime={event.starts_at}>{formatEventDate(event.starts_at, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
                    </div>
                    <h3>{event.title}</h3>
                    <p className="admin-event-card__venue">{event.venue}</p>
                    {event.description && <p className="admin-event-card__description">{event.description}</p>}
                    {event.ticket_types.length > 0 && <p className="admin-event-card__tickets">{event.ticket_types.length} ticket {event.ticket_types.length === 1 ? 'type' : 'types'} configured</p>}
                  </div>
                  <div className="admin-event-card__actions">
                    <button className="admin-events__secondary" type="button" onClick={() => beginEdit(event)} disabled={isSaving || Boolean(ticketTypesEventId) || (isFormOpen && !editingEventId)}>Edit details</button>
                    <button
                      className="admin-events__secondary"
                      type="button"
                      onClick={() => setTicketTypesEventId((current) => current === event.id ? null : event.id)}
                      disabled={isSaving || isFormOpen}
                      aria-expanded={ticketTypesEventId === event.id}
                    >
                      {ticketTypesEventId === event.id ? 'Hide ticket types' : `Manage tickets · ${event.ticket_types.length}`}
                    </button>
                    <button className="button-link" type="button" onClick={() => handleStatusChange(event)} disabled={pendingEventId === event.id || isSaving}>
                      {pendingEventId === event.id ? 'Saving…' : event.status === 'published' ? 'Unpublish' : 'Publish'}
                    </button>
                    {event.status === 'published' && <Link to={`/events/${event.id}`}>View public event</Link>}
                  </div>
                </div>
                {ticketTypesEventId === event.id && (
                  <TicketTypesManager eventId={event.id} onTicketTypesChange={handleTicketTypesChange} />
                )}
                {editingEventId === event.id && (
                  <EventEditorForm
                    draft={draft}
                    setDraft={setDraft}
                    onSubmit={handleSubmit}
                    onCancel={closeForm}
                    onDateTimeChange={handleDateTimeChange}
                    isSaving={isSaving}
                    isEditing
                    minDateTime={originalEditDateTime && new Date(originalEditDateTime) <= new Date()
                      ? originalEditDateTime
                      : toLocalDateTime(new Date())}
                    dateError={dateError}
                    formRef={editingFormRef}
                  />
                )}
              </article>
            ))}
          </div>
        )}

        {loadState === 'loading' && <p className="admin-events-state" role="status">Loading events…</p>}
        {loadState === 'error' && (
          <div className="admin-events-state" role="alert">
            <p>Events could not be loaded. {errorMessage}</p>
            <button className="button-link" type="button" onClick={retryLoading}>Try again</button>
          </div>
        )}
      </section>
    </section>
  )
}

export default AdminEventsPage
