const express = require('express')
const authController = require('../controllers/authController')
const { requireAuthentication } = require('../middleware/authMiddleware')
const { rateLimiters } = require('../middleware/rateLimiters')

const router = express.Router()

router.post('/register', rateLimiters.registration, authController.register)
router.post('/login', rateLimiters.loginIp, rateLimiters.loginFailure, authController.login)
router.post('/logout', authController.logout)
router.get('/me', requireAuthentication, authController.getCurrentUser)
router.patch('/me', requireAuthentication, authController.updateCurrentUser)

module.exports = router
