const express = require('express')
const adminController = require('../controllers/adminController')
const { requireAuthentication, requireAdministrator } = require('../middleware/authMiddleware')
const { readPosterUpload } = require('../middleware/posterUploadMiddleware')
const { rateLimiters } = require('../middleware/rateLimiters')

const router = express.Router()

// Protect the whole route group so future admin endpoints inherit this boundary.
router.use(requireAuthentication, requireAdministrator)

router.get('/dashboard', adminController.getDashboard)
router.get('/events', adminController.listEvents)
router.post('/events', adminController.createEvent)
router.patch('/events/:eventId', adminController.updateEvent)
router.patch('/events/:eventId/status', adminController.updateEventStatus)
// Only the Cloudinary routes are limited, per admin account and before the body is read.
// Other admin event and ticket-type writes are database-only and stay unlimited.
router.post('/events/:eventId/poster', rateLimiters.posterMutation, readPosterUpload, adminController.uploadEventPoster)
router.delete('/events/:eventId/poster', rateLimiters.posterMutation, adminController.removeEventPoster)
router.get('/events/:eventId/ticket-types', adminController.listTicketTypes)
router.post('/events/:eventId/ticket-types', adminController.createTicketType)
router.patch('/events/:eventId/ticket-types/:ticketTypeId', adminController.updateTicketType)

module.exports = router
