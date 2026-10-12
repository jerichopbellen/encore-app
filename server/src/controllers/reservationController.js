const notImplemented = require('../utils/notImplemented')

function createReservation(req, res) { return notImplemented(res, 'Creating a reservation') }
function getReservation(req, res) { return notImplemented(res, 'Getting a reservation') }
function cancelReservation(req, res) { return notImplemented(res, 'Cancelling a reservation') }
function checkoutReservation(req, res) { return notImplemented(res, 'Checking out a reservation') }

module.exports = { createReservation, getReservation, cancelReservation, checkoutReservation }
