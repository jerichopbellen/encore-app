const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:5173'
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'])
const ALLOWED_HEADERS = new Set(['accept', 'content-type', 'idempotency-key'])
const ALLOW_HEADERS_VALUE = 'Accept, Content-Type, Idempotency-Key'

function getAllowedOrigin() {
  return process.env.FRONTEND_ORIGIN || DEFAULT_FRONTEND_ORIGIN
}

function corsMiddleware(req, res, next) {
  const origin = req.get('Origin')
  res.vary('Origin')

  if (origin === getAllowedOrigin()) {
    res.set('Access-Control-Allow-Origin', origin)
    res.set('Access-Control-Allow-Credentials', 'true')
  }

  if (req.method !== 'OPTIONS') return next()
  if (!origin || origin !== getAllowedOrigin()) {
    return res.status(403).json({ success: false, message: 'This request origin is not allowed.' })
  }

  const requestedMethod = (req.get('Access-Control-Request-Method') || '').toUpperCase()
  const requestedHeaders = (req.get('Access-Control-Request-Headers') || '')
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean)

  if (!ALLOWED_METHODS.has(requestedMethod) || requestedHeaders.some((header) => !ALLOWED_HEADERS.has(header))) {
    return res.status(403).json({ success: false, message: 'This preflight request is not allowed.' })
  }

  res.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, DELETE, OPTIONS')
  res.set('Access-Control-Allow-Headers', ALLOW_HEADERS_VALUE)
  res.set('Access-Control-Max-Age', '600')
  return res.status(204).end()
}

module.exports = { corsMiddleware, getAllowedOrigin }
