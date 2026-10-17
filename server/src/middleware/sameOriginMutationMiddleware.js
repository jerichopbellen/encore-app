const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:5173'
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function sameOriginMutationMiddleware(req, res, next) {
  if (!MUTATION_METHODS.has(req.method)) return next()

  const origin = req.get('Origin')
  if (!origin) return next() // Non-browser clients do not send Origin.

  const allowedOrigin = process.env.FRONTEND_ORIGIN || DEFAULT_FRONTEND_ORIGIN
  if (origin !== allowedOrigin) {
    return res.status(403).json({ success: false, message: 'This request origin is not allowed.' })
  }

  return next()
}

module.exports = { sameOriginMutationMiddleware }
