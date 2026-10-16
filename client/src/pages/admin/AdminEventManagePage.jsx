import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import AdminEventForm from '../../components/admin/AdminEventForm'
import TicketTypesManager from '../../components/admin/TicketTypesManager'
import { getAdminEvents, updateAdminEvent, updateAdminEventStatus } from '../../services/adminEventsApi'
import { formatEventDate } from '../../utils/eventDisplay'
import useUnsavedChanges from '../../hooks/useUnsavedChanges'

function AdminEventManagePage() {
  const { eventId } = useParams()
  const location = useLocation()
  const [event, setEvent] = useState(null)
  const [loadState, setLoadState] = useState('loading')
  const [loadedEventId, setLoadedEventId] = useState(null)
  const [retryCount, setRetryCount] = useState(0)
  const [isEditing, setIsEditing] = useState(false)
  const [detailsDirty, setDetailsDirty] = useState(false)
  const [ticketsDirty, setTicketsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [pendingStatusChange, setPendingStatusChange] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [notice, setNotice] = useState(location.state?.notice || '')
  const submissionLock = useRef(false)
  const updateDetailsDirty = useCallback((dirty) => setDetailsDirty(dirty), [])
  const updateTicketsDirty = useCallback((dirty) => setTicketsDirty(dirty), [])
  const hasUnsavedChanges = detailsDirty || ticketsDirty

  useUnsavedChanges(hasUnsavedChanges)

  useEffect(() => {
    let isCurrentRequest = true
    getAdminEvents()
      .then((events) => {
        if (!isCurrentRequest) return
        const selectedEvent = events.find((item) => item.id === eventId)
        setEvent(selectedEvent || null)
        setLoadedEventId(eventId)
        setLoadState(selectedEvent ? 'success' : 'not-found')
      })
      .catch((error) => {
        if (!isCurrentRequest) return
        setErrorMessage(error.message)
        setLoadedEventId(eventId)
        setLoadState('error')
      })
    return () => { isCurrentRequest = false }
  }, [eventId, retryCount])

  async function handleSaveDetails(draft) {
    if (submissionLock.current) return
    submissionLock.current = true
    setErrorMessage('')
    setNotice('')
    setIsSaving(true)
    try {
      const updatedEvent = await updateAdminEvent(eventId, draft)
      setEvent(updatedEvent)
      setIsEditing(false)
      setDetailsDirty(false)
      setNotice('Event details saved.')
    } catch (error) {
      setErrorMessage(error.message)
    } finally {
      submissionLock.current = false
      setIsSaving(false)
    }
  }

  function handleCancelEditing() {
    if (detailsDirty && !window.confirm('Discard these event detail changes?')) return
    setIsEditing(false)
    setDetailsDirty(false)
    setErrorMessage('')
  }

  async function handleStatusChange() {
    if (!event) return
    const nextStatus = event.status === 'published' ? 'draft' : 'published'
    setPendingStatusChange(true)
    setErrorMessage('')
    setNotice('')
    try {
      const updatedEvent = await updateAdminEventStatus(event.id, nextStatus)
      setEvent(updatedEvent)
      setNotice(nextStatus === 'published' ? 'Event published.' : 'Event unpublished and returned to draft.')
    } catch (error) {
      setErrorMessage(error.message)
    } finally {
      setPendingStatusChange(false)
    }
  }

  function retryLoading() {
    setErrorMessage('')
    setLoadedEventId(null)
    setLoadState('loading')
    setRetryCount((count) => count + 1)
  }

  const currentLoadState = loadedEventId === eventId ? loadState : 'loading'

  if (currentLoadState === 'loading') return <p className="admin-events-state" role="status">Loading event workspace…</p>
  if (currentLoadState === 'error') {
    return (
      <div className="admin-events-state" role="alert">
        <p>Event details could not be loaded. {errorMessage}</p>
        <button className="button-link" type="button" onClick={retryLoading}>Try again</button>
        <Link to="/admin/events">Back to events</Link>
      </div>
    )
  }
  if (currentLoadState === 'not-found' || !event) {
    return (
      <section className="admin-event-not-found">
        <p className="eyebrow">EVENT NOT FOUND</p>
        <h1>This event is not in the catalogue.</h1>
        <p>It may have been removed, or the event address may be incomplete.</p>
        <Link className="button-link" to="/admin/events">Return to events</Link>
      </section>
    )
  }

  return (
    <section className="admin-event-page" aria-labelledby="admin-event-title">
      <nav className="admin-event-breadcrumb" aria-label="Breadcrumb">
        <Link to="/admin/events">Admin events</Link><span aria-hidden="true">/</span><span>Event workspace</span>
      </nav>
      <header className="admin-event-workspace__heading">
        <div className="admin-event-workspace__identity">
          <div className="admin-event-card__topline">
            <span className={`admin-event-status admin-event-status--${event.status}`}>{event.status === 'published' ? 'Published' : 'Draft'}</span>
            <time dateTime={event.starts_at}>{formatEventDate(event.starts_at, { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
          </div>
          <h1 id="admin-event-title">{event.title}</h1>
          <p>{event.venue}</p>
        </div>
        <div className="admin-event-workspace__actions">
          {!isEditing && <button className="admin-events__secondary" type="button" onClick={() => { setErrorMessage(''); setIsEditing(true) }}>Edit event details</button>}
          {event.status === 'published' && <Link to={`/events/${event.id}`}>View public event</Link>}
          {!isEditing && (
            <button className="button-link" type="button" onClick={handleStatusChange} disabled={pendingStatusChange || hasUnsavedChanges}>
              {pendingStatusChange ? 'Saving…' : event.status === 'published' ? 'Unpublish event' : 'Publish event'}
            </button>
          )}
        </div>
      </header>

      {notice && <p className="admin-events__message admin-events__message--success" role="status">{notice}</p>}
      {errorMessage && !isEditing && <p className="admin-events__message admin-events__message--error" role="alert">{errorMessage}</p>}

      <section className="admin-event-workspace__section" aria-labelledby="admin-event-details-heading">
        <div className="admin-event-workspace__section-heading">
          <div><p className="eyebrow">EVENT INFORMATION</p><h2 id="admin-event-details-heading">Event details</h2></div>
        </div>
        {isEditing ? (
          <AdminEventForm
            key={event.id}
            initialEvent={event}
            isSaving={isSaving}
            errorMessage={errorMessage}
            onDirtyChange={updateDetailsDirty}
            onSubmit={handleSaveDetails}
            onCancel={handleCancelEditing}
            submitLabel="Save changes"
          />
        ) : (
          <dl className="admin-event-details">
            <div><dt>Title</dt><dd>{event.title}</dd></div>
            <div><dt>Venue</dt><dd>{event.venue}</dd></div>
            <div><dt>Date and time</dt><dd>{formatEventDate(event.starts_at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</dd></div>
            <div className="admin-event-details__description"><dt>Description</dt><dd>{event.description || 'No description provided.'}</dd></div>
          </dl>
        )}
      </section>

      <section className="admin-event-workspace__section" aria-labelledby="admin-ticket-types-heading">
        <div className="admin-event-workspace__section-heading">
          <div><p className="eyebrow">INVENTORY</p><h2 id="admin-ticket-types-heading">Ticket types</h2><p>Manage prices and capacity for {event.title}.</p></div>
        </div>
        <TicketTypesManager key={event.id} eventId={event.id} onUnsavedChange={updateTicketsDirty} />
      </section>
    </section>
  )
}

export default AdminEventManagePage
