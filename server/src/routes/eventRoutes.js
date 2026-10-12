
const express = require('express')
const eventController = require('../controllers/eventController')

const router = express.Router()

router.get('/', eventController.listEvents)
router.get('/:eventId', eventController.getEvent)

module.exports = router
