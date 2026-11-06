
const express = require('express')
const eventRoutes = require('./routes/eventRoutes')
const authRoutes = require('./routes/authRoutes')
const reservationRoutes = require('./routes/reservationRoutes')
const bookingRoutes = require('./routes/bookingRoutes')
const adminRoutes = require('./routes/adminRoutes')
const paymentRoutes = require('./routes/paymentRoutes')
const paymentController = require('./controllers/paymentController')
const notFoundMiddleware = require('./middleware/notFoundMiddleware')
const errorMiddleware = require('./middleware/errorMiddleware')
const { corsMiddleware } = require('./middleware/corsMiddleware')
const { sameOriginMutationMiddleware } = require('./middleware/sameOriginMutationMiddleware')
const { requestLogger } = require('./middleware/requestLogger')
const { createReadinessHandler } = require('./controllers/readinessController')
const cookieParser = require('cookie-parser')
const { rateLimiters, configureTrustProxy } = require('./middleware/rateLimiters')
const { getRateLimitConfig } = require('./config/rateLimit')

const app = express()

// Express trusts a proxy only where IP-based rate limiting is enabled (NODE_ENV development or
// test). In production TRUST_PROXY_HOPS is ignored and IP-based limits stay off; see DEPLOYMENT.md.
configureTrustProxy(app, getRateLimitConfig(process.env).effectiveTrustProxyHops)

app.use('/api', corsMiddleware)
app.use('/api', sameOriginMutationMiddleware)
app.use(requestLogger)
// Stripe signs the exact bytes it sends, so this route must be registered before
// express.json() and receive the unparsed body. Stripe sends no Origin header, and
// the signature, not a session cookie, authenticates the request.
app.post('/api/payments/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), paymentController.stripeWebhook)
app.use(express.json())
app.use(cookieParser())

app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Encore API is running!',
  })
})

app.get('/api/ready', createReadinessHandler())

// Loose baseline for GET/HEAD API reads. Mounted after health, readiness and the Stripe
// webhook so those never reach it; stricter per-route limiters live in the route files.
app.use('/api', rateLimiters.generalRead)

app.use('/api/events', eventRoutes)
app.use('/api/auth', authRoutes)
// All reservation routes require an authenticated Encore session.
app.use('/api/reservations', reservationRoutes)
// Booking records are private to the authenticated customer who owns them.
app.use('/api/bookings', bookingRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/payments', paymentRoutes)

app.use(notFoundMiddleware)
app.use(errorMiddleware)

module.exports = app
