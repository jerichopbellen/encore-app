import { apiUrl } from './apiUrl'

export async function getAdminDashboard() {
  const url = apiUrl('/admin/dashboard')
  let response
  try {
    response = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
  } catch {
    throw new Error('Could not connect to Encore. Check that the API is running and try again.')
  }

  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.message || 'The dashboard could not be loaded.')
  if (!payload?.success || !payload.data) throw new Error('The dashboard response was incomplete. Try again.')
  return payload.data
}
