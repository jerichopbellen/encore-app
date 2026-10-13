const eventModel = require('../models/Event')

function listPublishedEvents() {
  return eventModel.findPublishedEvents()
}

function getPublishedEventById(id) {
  return eventModel.findPublishedEventById(id)
}

module.exports = { listPublishedEvents, getPublishedEventById }
