// Authentication is intentionally not implemented. Do not use this as protection.
function requireAuthentication(req, res) {
  return res.status(501).json({
    success: false,
    message: 'Authentication middleware is not implemented yet.',
  })
}

module.exports = { requireAuthentication }
