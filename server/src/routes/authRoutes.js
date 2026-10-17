const express = require('express')
const authController = require('../controllers/authController')
const { requireAuthentication } = require('../middleware/authMiddleware')

const router = express.Router()

router.post('/register', authController.register)
router.post('/login', authController.login)
router.post('/logout', authController.logout)
router.get('/me', requireAuthentication, authController.getCurrentUser)
router.patch('/me', requireAuthentication, authController.updateCurrentUser)

module.exports = router
