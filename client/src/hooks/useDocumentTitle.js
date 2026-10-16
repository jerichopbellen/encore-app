import { useEffect } from 'react'

export function formatDocumentTitle(pageName) {
  return pageName ? `${pageName} | Encore` : 'Encore'
}

export default function useDocumentTitle(pageName) {
  useEffect(() => {
    document.title = formatDocumentTitle(pageName)
  }, [pageName])
}
