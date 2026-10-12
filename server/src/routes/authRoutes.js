const express = require('express')
const authController = require('../controllers/authController')

const router = express.Router()

router.post('/register', authController.register)
router.post('/login', authController.login)
// This route is not protected yet; authentication is not implemented.
router.get('/me', authController.getCurrentUser)

module.exports = router
