import { useEffect, useState } from 'react'
import EventArtwork from '../events/EventArtwork'
import EventPosterField from './EventPosterField'
import { removeAdminEventPoster, uploadAdminEventPoster } from '../../services/adminEventsApi'

// The workspace's Poster tab: stage an upload or removal, then save just the
// poster without opening the event details form.
function AdminEventPosterPanel({ event, onEventChange, onDirtyChange }) {
  const [change, setChange] = useState(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const previewUrl = change?.type === 'upload' ? change.previewUrl : change?.type === 'remove' ? null : event.poster_url

  useEffect(() => {
    onDirtyChange(change !== null)
  }, [change, onDirtyChange])

  function handleChange(nextChange) {
    setError('')
    setNotice('')
    setChange(nextChange)
  }

  async function handleSave() {
    if (!change || isSaving) return
    const isUpload = change.type === 'upload'
    setIsSaving(true)
    setError('')
    setNotice('')
    try {
      // The poster the admin is looking at is the precondition, so a newer poster
      // saved elsewhere is never replaced or removed silently.
      const updatedEvent = isUpload
        ? await uploadAdminEventPoster(event.id, change.file, event.poster_public_id)
        : await removeAdminEventPoster(event.id, event.poster_public_id)
      if (isUpload) URL.revokeObjectURL(change.previewUrl)
      setChange(null)
      onEventChange(updatedEvent)
      setNotice(isUpload ? 'Custom poster saved.' : 'Custom poster removed. The default Encore poster is shown again.')
    } catch (saveError) {
      setError(`The poster could not be ${isUpload ? 'uploaded' : 'removed'}: ${saveError.message} Your selection is kept, so you can try again.`)
    } finally {
      setIsSaving(false)
    }
  }

  function handleDiscard() {
    if (change?.type === 'upload') URL.revokeObjectURL(change.previewUrl)
    handleChange(null)
  }

  return (
    <div className="admin-poster-panel">
      <figure className="admin-poster-panel__card">
        <EventArtwork event={event} posterUrl={previewUrl} />
        <figcaption>Discover card</figcaption>
      </figure>
      <div className="admin-poster-panel__controls">
        <EventPosterField
          previewEvent={event}
          currentPosterUrl={event.poster_url}
          change={change}
          onChange={handleChange}
          disabled={isSaving}
          isCreating={false}
        />
        {error && <p className="admin-events__message admin-events__message--error" role="alert">{error}</p>}
        {notice && <p className="admin-events__message admin-events__message--success" role="status">{notice}</p>}
        {change && (
          <div className="admin-poster-panel__actions">
            <button className="button-link" type="button" onClick={handleSave} disabled={isSaving}>
              {isSaving ? (change.type === 'upload' ? 'Uploading poster…' : 'Removing poster…') : change.type === 'upload' ? 'Save poster' : 'Remove poster'}
            </button>
            <button className="admin-events__secondary" type="button" onClick={handleDiscard} disabled={isSaving}>Discard</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminEventPosterPanel
