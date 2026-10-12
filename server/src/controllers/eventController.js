const notImplemented = require('../utils/notImplemented')

function listEvents(req, res) {
  return notImplemented(res, 'Listing events')
}

function getEvent(req, res) {
  return notImplemented(res, 'Getting an event')
}

module.exports = { listEvents, getEvent }
