const notImplemented = require('../utils/notImplemented')

function register(req, res) { return notImplemented(res, 'Registration') }
function login(req, res) { return notImplemented(res, 'Login') }
function getCurrentUser(req, res) { return notImplemented(res, 'Getting the current user') }

module.exports = { register, login, getCurrentUser }
