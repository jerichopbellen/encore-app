const express = require('express')
const authController = require('../controllers/authController')
const { requireAuthentication } = require('../middleware/authMiddleware')
const AppError = require('../utils/AppError')

const router = express.Router()

// In this setup the browser talks to Vite and Vite proxies /api to Express,
// so browser auth requests are same-origin. Reject cross-origin form requests.
function requireSameOrigin(req, res, next) {
  const origin = req.get('origin')
  if (!origin) return next() // Non-browser clients do not send Origin.

  const allowedOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'
  if (origin !== allowedOrigin) {
    return next(new AppError('This request origin is not allowed.', 403))
  }
  return next()
}

router.post('/register', requireSameOrigin, authController.register)
router.post('/login', requireSameOrigin, authController.login)
router.post('/logout', requireSameOrigin, authController.logout)
router.get('/me', requireAuthentication, authController.getCurrentUser)

module.exports = router
