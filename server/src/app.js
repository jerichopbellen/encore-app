
const express = require('express')
const eventRoutes = require('./routes/eventRoutes')
const authRoutes = require('./routes/authRoutes')
const reservationRoutes = require('./routes/reservationRoutes')
const bookingRoutes = require('./routes/bookingRoutes')
const adminRoutes = require('./routes/adminRoutes')
const notFoundMiddleware = require('./middleware/notFoundMiddleware')
const errorMiddleware = require('./middleware/errorMiddleware')
const cookieParser = require('cookie-parser')

const app = express()

app.use(express.json())
app.use(cookieParser())

app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Encore API is running!',
  })
})

app.use('/api/events', eventRoutes)
app.use('/api/auth', authRoutes)
// All reservation routes require an authenticated Encore session.
app.use('/api/reservations', reservationRoutes)
// Booking records are private to the authenticated customer who owns them.
app.use('/api/bookings', bookingRoutes)
// Admin routes are not protected yet; do not treat them as secure.
app.use('/api/admin', adminRoutes)

app.use(notFoundMiddleware)
app.use(errorMiddleware)

module.exports = app
