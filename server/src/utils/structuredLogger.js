function getRouteLabel(req) {
  return req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched'
}

function logApiError(req, error, statusCode) {
  if (statusCode < 500) return
  console.error(JSON.stringify({
    event: 'api_error',
    method: req.method,
    route: getRouteLabel(req),
    status: statusCode,
    error_type: typeof error?.name === 'string' ? error.name : 'Error',
  }))
}

module.exports = { logApiError }
