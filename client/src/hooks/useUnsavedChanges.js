import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router'

const defaultMessage = 'You have unsaved changes. Leave this page and discard them?'

function useUnsavedChanges(isDirty, message = defaultMessage) {
  const location = useLocation()
  const isDirtyRef = useRef(isDirty)
  const historyIndexRef = useRef(window.history.state?.idx ?? 0)
  const isReversingHistoryRef = useRef(false)

  useLayoutEffect(() => {
    isDirtyRef.current = isDirty
    const historyIndex = window.history.state?.idx
    if (typeof historyIndex === 'number') historyIndexRef.current = historyIndex
  }, [isDirty, location.key])

  useEffect(() => {
    if (!isDirty) return undefined

    function handleBeforeUnload(event) {
      if (!isDirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }

    function handleDocumentClick(event) {
      if (
        !isDirtyRef.current
        || event.defaultPrevented
        || event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
      ) return

      const link = event.target.closest?.('a[href]')
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return

      const destination = new URL(link.href, window.location.href)
      const current = new URL(window.location.href)
      if (destination.pathname === current.pathname && destination.search === current.search) return

      if (window.confirm(message)) {
        isDirtyRef.current = false
        return
      }

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    function handlePopState(event) {
      if (isReversingHistoryRef.current) {
        isReversingHistoryRef.current = false
        if (typeof event.state?.idx === 'number') historyIndexRef.current = event.state.idx
        return
      }

      if (!isDirtyRef.current) {
        if (typeof event.state?.idx === 'number') historyIndexRef.current = event.state.idx
        return
      }

      const currentIndex = historyIndexRef.current
      const destinationIndex = event.state?.idx
      const delta = typeof destinationIndex === 'number' ? destinationIndex - currentIndex : -1
      if (delta === 0) return

      if (window.confirm(message)) {
        isDirtyRef.current = false
        historyIndexRef.current = typeof destinationIndex === 'number'
          ? destinationIndex
          : currentIndex + delta
        return
      }

      isReversingHistoryRef.current = true
      window.history.go(-delta)
    }

    document.addEventListener('click', handleDocumentClick, true)
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('popstate', handlePopState)
    return () => {
      document.removeEventListener('click', handleDocumentClick, true)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('popstate', handlePopState)
    }
  }, [isDirty, message])
}

export default useUnsavedChanges
