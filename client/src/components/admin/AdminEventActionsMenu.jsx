import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'

// Secondary actions for one event row: publish/unpublish and the public page.
// A disclosure (button + panel) keeps each row to a single primary action.
function AdminEventActionsMenu({ event, isSaving, onStatusChange }) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef(null)
  const buttonRef = useRef(null)
  const panelId = useId()

  useEffect(() => {
    if (!isOpen) return undefined
    function handlePointerDown(pointerEvent) {
      if (!containerRef.current?.contains(pointerEvent.target)) setIsOpen(false)
    }
    function handleKeyDown(keyEvent) {
      if (keyEvent.key !== 'Escape') return
      setIsOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  function handleStatusClick() {
    setIsOpen(false)
    onStatusChange(event)
  }

  return (
    <div className="admin-event-menu" ref={containerRef}>
      <button
        ref={buttonRef}
        className="admin-event-menu__trigger"
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-label={`More actions for ${event.title}`}
        onClick={() => setIsOpen((open) => !open)}
        disabled={isSaving}
      >
        {isSaving ? '…' : '···'}
      </button>
      {isOpen && (
        <div className="admin-event-menu__panel" id={panelId}>
          <button type="button" onClick={handleStatusClick}>
            {event.status === 'published' ? 'Unpublish (return to draft)' : 'Publish event'}
          </button>
          {event.status === 'published' && <Link to={`/events/${event.id}`}>View public event</Link>}
        </div>
      )}
    </div>
  )
}

export default AdminEventActionsMenu
