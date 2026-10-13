require('dotenv').config()

const app = require('./app')
const { disconnectPrisma } = require('./config/prisma')

const PORT = 5000

const server = app.listen(PORT, () => {
  console.log(`Encore API is running on http://localhost:${PORT}`)
})

async function shutdown(signal) {
  console.log(`Received ${signal}; closing the server.`)

  server.close(async (error) => {
    if (error) {
      console.error('Error while closing the HTTP server:', error.message)
      process.exitCode = 1
    }

    try {
      await disconnectPrisma()
    } catch (disconnectError) {
      console.error('Error while closing Prisma:', disconnectError.message)
      process.exitCode = 1
    }
  })
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
