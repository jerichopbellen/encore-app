const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export async function getAdminDashboard() {
  let response
  try {
    response = await fetch(`${apiBaseUrl}/api/admin/dashboard`, {
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
