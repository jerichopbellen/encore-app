const notImplemented = require('../utils/notImplemented')

function createEvent(req, res) { return notImplemented(res, 'Creating an event') }
function updateEvent(req, res) { return notImplemented(res, 'Updating an event') }
function updateEventStatus(req, res) { return notImplemented(res, 'Updating event status') }
function createTicketType(req, res) { return notImplemented(res, 'Creating a ticket type') }

module.exports = { createEvent, updateEvent, updateEventStatus, createTicketType }
