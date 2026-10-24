import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import AdminEventForm from '../../components/admin/AdminEventForm'
import TicketTypesManager from '../../components/admin/TicketTypesManager'
import AdminEventOverview from '../../components/admin/AdminEventOverview'
import AdminEventPosterPanel from '../../components/admin/AdminEventPosterPanel'
import EventArtwork from '../../components/events/EventArtwork'
import {
  getAdminEvents,
  removeAdminEventPoster,
  updateAdminEvent,
  updateAdminEventStatus,
  uploadAdminEventPoster,
} from '../../services/adminEventsApi'
import { formatEventDate } from '../../utils/eventDisplay'
import useUnsavedChanges from '../../hooks/useUnsavedChanges'
import useDocumentTitle from '../../hooks/useDocumentTitle'

const WORKSPACE_TABS = [
  ['overview', 'Overview'],
  ['details', 'Details'],
  ['tickets', 'Ticket types'],
  ['poster', 'Poster'],
]

function AdminEventManagePage() {
  const { eventId } = useParams()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [event, setEvent] = useState(null)
  const [loadState, setLoadState] = useState('loading')
  const [loadedEventId, setLoadedEventId] = useState(null)
  const [retryCount, setRetryCount] = useState(0)
  const [isEditing, setIsEditing] = useState(false)
  const [detailsDirty, setDetailsDirty] = useState(false)
  const [ticketsDirty, setTicketsDirty] = useState(false)
  const [posterDirty, setPosterDirty] = useState(false)
  const [ticketTypes, setTicketTypes] = useState([])
  const [isSaving, setIsSaving] = useState(false)
  const [pendingStatusChange, setPendingStatusChange] = useState(false)
  const [errorMessage, setErrorMessage] = useState(location.state?.error || '')
  const [savingLabel, setSavingLabel] = useState('Saving…')
  const [notice, setNotice] = useState(location.state?.notice || '')
  const submissionLock = useRef(false)
  const updateDetailsDirty = useCallback((dirty) => setDetailsDirty(dirty), [])
  const updateTicketsDirty = useCallback((dirty) => setTicketsDirty(dirty), [])
  const updatePosterDirty = useCallback((dirty) => setPosterDirty(dirty), [])
  const hasUnsavedChanges = detailsDirty || ticketsDirty || posterDirty
  // The tab lives in the URL (?tab=poster) so reloads and shared links keep it. A failed
  // poster upload from the create page opens the Poster tab to retry.
  const requestedTab = searchParams.get('tab')
  const activeTab = WORKSPACE_TABS.some(([id]) => id === requestedTab)
    ? requestedTab
    : location.state?.error ? 'poster' : 'overview'

  function selectTab(tab) {
    setSearchParams(tab === 'overview' ? {} : { tab }, { replace: true })
  }

  useUnsavedChanges(hasUnsavedChanges)

  useEffect(() => {
    let isCurrentRequest = true
    getAdminEvents()
      .then((events) => {
        if (!isCurrentRequest) return
        const selectedEvent = events.find((item) => item.id === eventId)
        setEvent(selectedEvent || null)
        setTicketTypes(selectedEvent?.ticket_types || [])
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

  async function handleSaveDetails(draft, posterChange) {
    if (submissionLock.current) return
    submissionLock.current = true
    setErrorMessage('')
    setNotice('')
    setIsSaving(true)
    setSavingLabel('Saving…')
    try {
      let updatedEvent = await updateAdminEvent(eventId, draft)
      setEvent(updatedEvent)
      if (posterChange) {
        const isUpload = posterChange.type === 'upload'
        setSavingLabel(isUpload ? 'Uploading poster…' : 'Removing poster…')
        try {
          updatedEvent = isUpload
            ? await uploadAdminEventPoster(eventId, posterChange.file, posterChange.expectedPublicId)
            : await removeAdminEventPoster(eventId, posterChange.expectedPublicId)
        } catch (error) {
          // Details are saved; the form stays open with the poster change so it can be retried.
          setErrorMessage(`Event details were saved, but the poster could not be ${isUpload ? 'uploaded' : 'removed'}: ${error.message} Choose Save changes to try again.`)
          return
        }
        setEvent(updatedEvent)
      }
      setIsEditing(false)
      setDetailsDirty(false)
      setNotice(posterChange?.type === 'upload'
        ? 'Event details and custom poster saved.'
        : posterChange?.type === 'remove'
          ? 'Event details saved. The default Encore poster has been restored.'
          : 'Event details saved.')
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
  useDocumentTitle(currentLoadState === 'success' && event ? event.title : 'Event workspace')

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

  function focusTab(tab) {
    selectTab(tab)
    // Wait for the re-render so the newly selected tab is focusable.
    window.requestAnimationFrame(() => document.getElementById(`admin-event-tab-${tab}`)?.focus())
  }

  function handleTabKeyDown(keyEvent) {
    const index = WORKSPACE_TABS.findIndex(([id]) => id === activeTab)
    const lastIndex = WORKSPACE_TABS.length - 1
    const nextIndex = {
      ArrowRight: index === lastIndex ? 0 : index + 1,
      ArrowLeft: index === 0 ? lastIndex : index - 1,
      Home: 0,
      End: lastIndex,
    }[keyEvent.key]
    if (nextIndex === undefined) return
    keyEvent.preventDefault()
    focusTab(WORKSPACE_TABS[nextIndex][0])
  }

  function beginEditing() {
    setErrorMessage('')
    setIsEditing(true)
    selectTab('details')
  }

  return (
    <section className="admin-event-page admin-event-workspace" aria-labelledby="admin-event-title">
      <nav className="admin-event-breadcrumb" aria-label="Breadcrumb">
        <Link to="/admin/events">Admin events</Link><span aria-hidden="true">/</span><span>{event.title}</span>
      </nav>
      <header className="admin-event-workspace__heading">
        <div className="admin-event-workspace__poster" aria-hidden="true"><EventArtwork event={event} /></div>
        <div className="admin-event-workspace__identity">
          <p className="admin-event-workspace__meta">
            <span className={`admin-event-badge admin-event-badge--${event.status}`}>{event.status === 'published' ? 'Published' : 'Draft'}</span>
            <time dateTime={event.starts_at}>{formatEventDate(event.starts_at, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
            <span>{event.venue}</span>
          </p>
          <h1 id="admin-event-title">{event.title}</h1>
        </div>
        <div className="admin-event-workspace__actions">
          {event.status === 'published' && <Link className="admin-events__secondary" to={`/events/${event.id}`}>View public event</Link>}
          <button className={`button-link admin-event-workspace__status-action admin-event-workspace__status-action--${event.status}`} type="button" onClick={handleStatusChange} disabled={pendingStatusChange || hasUnsavedChanges}>
            {pendingStatusChange ? 'Saving…' : event.status === 'published' ? 'Unpublish' : 'Publish event'}
          </button>
        </div>
      </header>
      {hasUnsavedChanges && <p className="admin-event-workspace__hint">Save or discard your changes before changing the event's visibility.</p>}

      {notice && <p className="admin-events__message admin-events__message--success" role="status">{notice}</p>}
      {errorMessage && !isEditing && <p className="admin-events__message admin-events__message--error" role="alert">{errorMessage}</p>}

      <div className="admin-event-tabs" role="tablist" aria-label="Event workspace sections" onKeyDown={handleTabKeyDown}>
        {WORKSPACE_TABS.map(([id, label]) => (
          <button
            key={id}
            id={`admin-event-tab-${id}`}
            className="admin-event-tabs__tab"
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`admin-event-panel-${id}`}
            tabIndex={activeTab === id ? 0 : -1}
            onClick={() => selectTab(id)}
          >
            {label}
            {id === 'tickets' && <span className="admin-event-tabs__count">{ticketTypes.length}</span>}
            {((id === 'details' && detailsDirty) || (id === 'tickets' && ticketsDirty) || (id === 'poster' && posterDirty)) && (
              <span className="admin-event-tabs__dirty" title="Unsaved changes"><span className="sr-only">(unsaved changes)</span></span>
            )}
          </button>
        ))}
      </div>

      {/* Panels stay mounted while hidden so unsaved work survives switching tabs. */}
      <div className="admin-event-tabs__panel" id="admin-event-panel-overview" role="tabpanel" aria-labelledby="admin-event-tab-overview" hidden={activeTab !== 'overview'}>
        <AdminEventOverview
          event={event}
          ticketTypes={ticketTypes}
          onOpenTab={selectTab}
          onEditDetails={beginEditing}
          onStatusChange={handleStatusChange}
          isStatusPending={pendingStatusChange}
          isStatusBlocked={hasUnsavedChanges}
        />
      </div>

      <div className="admin-event-tabs__panel" id="admin-event-panel-details" role="tabpanel" aria-labelledby="admin-event-tab-details" hidden={activeTab !== 'details'}>
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
            savingLabel={savingLabel}
          />
        ) : (
          <div className="admin-event-details-card">
            <div className="admin-event-details-card__heading">
              <div><p className="eyebrow">EVENT INFORMATION</p><h2>Details</h2></div>
              <button className="admin-events__secondary" type="button" onClick={beginEditing}>Edit details</button>
            </div>
            <dl className="admin-event-details">
              <div><dt>Title</dt><dd>{event.title}</dd></div>
              <div><dt>Venue</dt><dd>{event.venue}</dd></div>
              <div><dt>Date and time</dt><dd>{formatEventDate(event.starts_at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</dd></div>
              <div><dt>Status</dt><dd>{event.status === 'published' ? 'Published' : 'Draft'}</dd></div>
              <div className="admin-event-details__description"><dt>Description</dt><dd>{event.description || 'No description provided.'}</dd></div>
            </dl>
          </div>
        )}
      </div>

      <div className="admin-event-tabs__panel" id="admin-event-panel-tickets" role="tabpanel" aria-labelledby="admin-event-tab-tickets" hidden={activeTab !== 'tickets'}>
        <TicketTypesManager
          key={event.id}
          eventId={event.id}
          onUnsavedChange={updateTicketsDirty}
          onTicketTypesChange={setTicketTypes}
        />
      </div>

      <div className="admin-event-tabs__panel" id="admin-event-panel-poster" role="tabpanel" aria-labelledby="admin-event-tab-poster" hidden={activeTab !== 'poster'}>
        <AdminEventPosterPanel
          key={event.id}
          event={event}
          onEventChange={setEvent}
          onDirtyChange={updatePosterDirty}
        />
      </div>
    </section>
  )
}

export default AdminEventManagePage
