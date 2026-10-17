require('dotenv').config()

const { validateEnvironment } = require('./config/environment')
const { disconnectPrisma } = require('./config/prisma')

let configuration
try {
  configuration = validateEnvironment(process.env)
} catch (error) {
  console.error(`Encore startup configuration error: ${error.message}`)
  process.exit(1)
}

const app = require('./app')
const server = app.listen(configuration.port, configuration.host, () => {
  console.log(`Encore API is listening on ${configuration.host}:${configuration.port}`)
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
