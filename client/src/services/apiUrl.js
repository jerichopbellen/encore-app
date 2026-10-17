// Production must use the same-origin Vercel proxy. A configured API origin is
// honored only in local development, where Vite's /api proxy remains available.
const rawApiBaseUrl = import.meta.env.PROD ? '' : import.meta.env.VITE_API_BASE_URL?.trim() || ''

function getApiBaseUrl() {
  // An empty base uses the same-origin /api path. Vite proxies it locally,
  // and Vercel proxies it to Render in production.
  if (!rawApiBaseUrl) return ''

  let parsed
  try {
    parsed = new URL(rawApiBaseUrl)
  } catch {
    throw new Error('VITE_API_BASE_URL must be an absolute HTTP or HTTPS API origin.')
  }

  if (!['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    throw new Error('VITE_API_BASE_URL must contain only an HTTP or HTTPS origin.')
  }

  return parsed.origin
}

export function apiUrl(path) {
  if (!path.startsWith('/')) throw new Error('API paths must start with a slash.')
  return `${getApiBaseUrl()}/api${path}`
}
