require('dotenv').config()

const { validateEnvironment } = require('./config/environment')
const { getRateLimitConfig } = require('./config/rateLimit')
const { disconnectPrisma } = require('./config/prisma')

let configuration
try {
  configuration = validateEnvironment(process.env)
} catch (error) {
  console.error(`Encore startup configuration error: ${error.message}`)
  process.exit(1)
}

const rateLimitConfig = getRateLimitConfig(process.env)
if (!rateLimitConfig.ipLimitingEnabled) {
  console.warn('Encore rate limiting: IP-based limits are disabled (they run only when NODE_ENV is "development" or "test"). Account-based limits remain active.')
  if (rateLimitConfig.trustProxyHops !== null) {
    console.warn('Encore rate limiting: TRUST_PROXY_HOPS is set but ignored while IP-based limits are disabled. Leave it unset.')
  }
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
