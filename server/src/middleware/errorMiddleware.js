function errorMiddleware(error, req, res, next) {
  if (res.headersSent) return next(error)

  const statusCode = error.statusCode || 500
  return res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? 'An unexpected server error occurred.' : error.message,
  })
}

module.exports = errorMiddleware
