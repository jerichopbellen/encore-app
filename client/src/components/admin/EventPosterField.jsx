import { useRef, useState } from 'react'
import EventArtwork from '../events/EventArtwork'

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
// The server enforces the configured limit (4 MB by default); this only stops
// files that no Encore configuration could accept before they are sent.
const ABSOLUTE_MAX_BYTES = 10 * 1024 * 1024

// Lets an admin stage a poster change. Nothing is uploaded here: the parent form
// sends the staged change when the event is saved. `change` is null (keep the
// current poster), { type: 'upload', file, previewUrl }, or { type: 'remove' }.
// The form's summary shows the Discover card preview; this section shows the
// poster as the event page's hero presents it, beside the orange title block.
function EventPosterField({ previewEvent, currentPosterUrl, change, onChange, disabled, isCreating }) {
  const inputRef = useRef(null)
  const [error, setError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const hasCustomPoster = Boolean(currentPosterUrl)
  const shownPosterUrl = change?.type === 'upload' ? change.previewUrl : change?.type === 'remove' ? null : currentPosterUrl
  const saveWord = isCreating ? 'create the event' : 'save'

  function replaceChange(nextChange) {
    if (change?.type === 'upload') URL.revokeObjectURL(change.previewUrl)
    setError('')
    onChange(nextChange)
  }

  function acceptFile(file) {
    if (!file) return
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Choose a JPEG, PNG, or WebP image. SVG and other formats are not supported.')
      return
    }
    if (file.size === 0) {
      setError('That file is empty. Choose a different image.')
      return
    }
    if (file.size > ABSOLUTE_MAX_BYTES) {
      setError('That image is too large. Choose an image of 4 MB or smaller.')
      return
    }
    replaceChange({ type: 'upload', file, previewUrl: URL.createObjectURL(file) })
  }

  function handleFileChange(event) {
    const [file] = event.target.files
    // Clear the input so choosing the same file again still triggers a change.
    event.target.value = ''
    acceptFile(file)
  }

  function handleDragOver(event) {
    if (disabled) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsDragging(true)
  }

  function handleDrop(event) {
    event.preventDefault()
    setIsDragging(false)
    if (disabled) return
    acceptFile(event.dataTransfer.files?.[0])
  }

  let status
  if (change?.type === 'upload') status = `New image selected: ${change.file.name}. It will be uploaded when you ${saveWord}.`
  else if (change?.type === 'remove') status = 'The custom poster will be removed when you save. Encore\'s default generated poster will be shown again.'
  else if (hasCustomPoster) status = 'This event uses a custom poster.'
  else status = 'No custom poster. Encore\'s generated default poster is shown.'

  return (
    <fieldset className="admin-poster-field" disabled={disabled}>
      <legend className="admin-poster-field__legend">Event poster</legend>
      <div
        className={isDragging ? 'admin-poster-field__dropzone admin-poster-field__dropzone--active' : 'admin-poster-field__dropzone'}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <p>Drag a JPEG, PNG, or WebP image here, or</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          onChange={handleFileChange}
          hidden
        />
        <button className="admin-events__secondary" type="button" onClick={() => inputRef.current?.click()}>
          {hasCustomPoster || change?.type === 'upload' ? 'Replace image' : 'Choose image'}
        </button>
        <small>Up to 4 MB. Discover cards and the event page both show it at 4:3, so keep key details near the center.</small>
      </div>
      {error && <p className="admin-event-form__field-error" role="alert">{error}</p>}
      <div className="admin-poster-field__current">
        <figure>
          <div className="admin-poster-field__hero" aria-hidden="true">
            <EventArtwork event={previewEvent} posterUrl={shownPosterUrl} variant="hero" />
            <div className="admin-poster-field__hero-info">
              <span className="admin-poster-field__hero-venue">{previewEvent.venue}</span>
              <span className="admin-poster-field__hero-title">{previewEvent.title}</span>
            </div>
          </div>
          <figcaption>Event page</figcaption>
        </figure>
        <div>
          <p className="admin-poster-field__status" role="status">{status}</p>
          <div className="admin-poster-field__actions">
            {change?.type === 'upload' && (
              <button className="admin-events__secondary" type="button" onClick={() => replaceChange(null)}>Cancel new image</button>
            )}
            {hasCustomPoster && change?.type !== 'remove' && (
              <button className="admin-events__secondary admin-poster-field__remove" type="button" onClick={() => replaceChange({ type: 'remove' })}>
                Remove custom poster
              </button>
            )}
            {change?.type === 'remove' && (
              <button className="admin-events__secondary" type="button" onClick={() => replaceChange(null)}>Keep custom poster</button>
            )}
          </div>
          {hasCustomPoster && <p className="admin-poster-field__help">Removing the custom poster restores Encore's default generated poster.</p>}
        </div>
      </div>
    </fieldset>
  )
}

export default EventPosterField
