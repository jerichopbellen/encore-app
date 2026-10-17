const QUIET_PATHS = new Set(['/api/health', '/api/ready'])

function requestLogger(req, res, next) {
  if (process.env.NODE_ENV === 'test' || QUIET_PATHS.has(req.path)) return next()

  const startedAt = process.hrtime.bigint()
  res.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6
    const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched'
    console.log(JSON.stringify({
      event: 'http_request',
      method: req.method,
      route,
      status: res.statusCode,
      duration_ms: Math.round(durationMs * 100) / 100,
    }))
  })
  return next()
}

module.exports = { requestLogger }
