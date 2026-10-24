import { useCallback, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import AdminEventForm from '../../components/admin/AdminEventForm'
import { createAdminEvent, uploadAdminEventPoster } from '../../services/adminEventsApi'
import useUnsavedChanges from '../../hooks/useUnsavedChanges'

function AdminEventCreatePage() {
  const navigate = useNavigate()
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [savingLabel, setSavingLabel] = useState('Saving…')
  const submissionLock = useRef(false)
  const updateDirtyState = useCallback((dirty) => setIsDirty(dirty), [])

  useUnsavedChanges(isDirty)

  async function handleSubmit(eventDraft, posterChange) {
    if (submissionLock.current) return
    submissionLock.current = true
    setErrorMessage('')
    setIsSaving(true)
    setSavingLabel('Creating event…')
    try {
      const createdEvent = await createAdminEvent(eventDraft)
      if (createdEvent?.id) {
        let notice = 'Event created as a draft.'
        let posterError = ''
        // The event exists before its poster is uploaded. If the upload fails, the
        // event keeps the default poster and the admin can retry from its workspace.
        if (posterChange?.type === 'upload') {
          setSavingLabel('Uploading poster…')
          try {
            await uploadAdminEventPoster(createdEvent.id, posterChange.file, null)
            notice = 'Event created as a draft with its custom poster.'
          } catch (error) {
            posterError = `The poster could not be uploaded: ${error.message} The event uses the default poster for now; choose Edit event details to try again.`
          }
        }
        navigate(`/admin/events/${createdEvent.id}`, {
          replace: true,
          state: { notice, error: posterError },
        })
      } else {
        navigate('/admin/events', {
          replace: true,
          state: { notice: 'Event created as a draft.' },
        })
      }
    } catch (error) {
      setErrorMessage(error.message)
    } finally {
      submissionLock.current = false
      setIsSaving(false)
    }
  }

  function handleCancel() {
    if (isDirty && !window.confirm('Discard this new event and return to the event catalogue?')) return
    navigate('/admin/events')
  }

  return (
    <section className="admin-event-page" aria-labelledby="admin-event-create-title">
      <nav className="admin-event-breadcrumb" aria-label="Breadcrumb">
        <Link to="/admin/events">Admin events</Link><span aria-hidden="true">/</span><span>New event</span>
      </nav>
      <header className="admin-event-page__heading">
        <p className="eyebrow">ENCORE ADMIN · EVENT SETUP</p>
        <h1 id="admin-event-create-title">Create an event</h1>
        <p>Set up the event details first. New events remain drafts until you publish them.</p>
      </header>
      <AdminEventForm
        isSaving={isSaving}
        errorMessage={errorMessage}
        onDirtyChange={updateDirtyState}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        submitLabel="Create event"
        savingLabel={savingLabel}
      />
    </section>
  )
}

export default AdminEventCreatePage
