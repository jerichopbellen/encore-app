export function readAdminEventsResponse(payload, expectsList) {
  const hasExpectedData = expectsList
    ? Array.isArray(payload?.data)
    : payload?.data !== null
      && typeof payload?.data === 'object'
      && !Array.isArray(payload.data)

  if (!payload?.success || !hasExpectedData) {
    throw new Error('Encore returned an unexpected event management response.')
  }

  return payload.data
}
