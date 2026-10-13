const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

async function requestAuthApi(path, options = {}) {
  let response
  try {
    response = await fetch(`${apiBaseUrl}/api/auth${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    })
  } catch {
    throw new Error('Could not connect to Encore. Check that the API is running and try again.')
  }

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(payload?.message || 'The authentication request failed.')
    error.status = response.status
    throw error
  }
  return payload
}

export function getCurrentUser() {
  return requestAuthApi('/me')
}

export function updateCurrentUser(profile) {
  return requestAuthApi('/me', {
    method: 'PATCH',
    body: JSON.stringify(profile),
  })
}

export function login(credentials) {
  return requestAuthApi('/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  })
}

export function register(account) {
  return requestAuthApi('/register', {
    method: 'POST',
    body: JSON.stringify(account),
  })
}

export function logout() {
  return requestAuthApi('/logout', { method: 'POST' })
}
