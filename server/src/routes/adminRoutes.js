const express = require('express')
const adminController = require('../controllers/adminController')

const router = express.Router()

// These routes are not protected yet; do not expose them as secure admin APIs.
router.post('/events', adminController.createEvent)
router.patch('/events/:eventId', adminController.updateEvent)
router.patch('/events/:eventId/status', adminController.updateEventStatus)
router.post('/events/:eventId/ticket-types', adminController.createTicketType)

module.exports = router
