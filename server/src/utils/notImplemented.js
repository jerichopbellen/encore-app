function notImplemented(res, operation) {
  return res.status(501).json({
    success: false,
    message: `${operation} is not implemented yet.`,
  })
}

module.exports = notImplemented
