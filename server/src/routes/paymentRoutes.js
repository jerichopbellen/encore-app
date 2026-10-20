const express = require('express')
const paymentController = require('../controllers/paymentController')

const router = express.Router()

// Public and secret-free: tells the UI whether to offer simulated or Stripe checkout.
router.get('/config', paymentController.getPaymentConfig)

module.exports = router
