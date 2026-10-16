import { useCallback, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import AdminEventForm from '../../components/admin/AdminEventForm'
import { createAdminEvent } from '../../services/adminEventsApi'
import useUnsavedChanges from '../../hooks/useUnsavedChanges'

function AdminEventCreatePage() {
  const navigate = useNavigate()
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const submissionLock = useRef(false)
  const updateDirtyState = useCallback((dirty) => setIsDirty(dirty), [])

  useUnsavedChanges(isDirty)

  async function handleSubmit(eventDraft) {
    if (submissionLock.current) return
    submissionLock.current = true
    setErrorMessage('')
    setIsSaving(true)
    try {
      const createdEvent = await createAdminEvent(eventDraft)
      if (createdEvent?.id) {
        navigate(`/admin/events/${createdEvent.id}`, {
          replace: true,
          state: { notice: 'Event created as a draft.' },
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
      />
    </section>
  )
}

export default AdminEventCreatePage
