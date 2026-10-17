
const express = require('express')
const eventRoutes = require('./routes/eventRoutes')
const authRoutes = require('./routes/authRoutes')
const reservationRoutes = require('./routes/reservationRoutes')
const bookingRoutes = require('./routes/bookingRoutes')
const adminRoutes = require('./routes/adminRoutes')
const notFoundMiddleware = require('./middleware/notFoundMiddleware')
const errorMiddleware = require('./middleware/errorMiddleware')
const { corsMiddleware } = require('./middleware/corsMiddleware')
const { sameOriginMutationMiddleware } = require('./middleware/sameOriginMutationMiddleware')
const { requestLogger } = require('./middleware/requestLogger')
const { createReadinessHandler } = require('./controllers/readinessController')
const cookieParser = require('cookie-parser')

const app = express()

app.use('/api', corsMiddleware)
app.use('/api', sameOriginMutationMiddleware)
app.use(requestLogger)
app.use(express.json())
app.use(cookieParser())

app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Encore API is running!',
  })
})

app.get('/api/ready', createReadinessHandler())

app.use('/api/events', eventRoutes)
app.use('/api/auth', authRoutes)
// All reservation routes require an authenticated Encore session.
app.use('/api/reservations', reservationRoutes)
// Booking records are private to the authenticated customer who owns them.
app.use('/api/bookings', bookingRoutes)
app.use('/api/admin', adminRoutes)

app.use(notFoundMiddleware)
app.use(errorMiddleware)

module.exports = app
