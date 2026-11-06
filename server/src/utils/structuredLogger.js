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

// Records that a limiter answered 429. Only the limiter's name, the route TEMPLATE (never the
// raw URL, which can hold IDs or query strings) and the status are logged. Emails, IP
// addresses, user IDs, bodies, headers, cookies and tokens are deliberately never read here.
function logRateLimited(req, limiterName) {
  const route = req.route ? `${req.baseUrl}${req.route.path}` : (req.baseUrl || 'unmatched')
  console.warn(JSON.stringify({ event: 'rate_limited', limiter: limiterName, route, status: 429 }))
}

module.exports = { logApiError, logRateLimited }
