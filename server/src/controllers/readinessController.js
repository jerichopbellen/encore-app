const { getPrismaClient } = require('../config/prisma')

const READINESS_TIMEOUT_MS = 3000

function createReadinessHandler(getClient = getPrismaClient) {
  return async function readiness(req, res) {
    let timeoutId
    try {
      const prisma = await getClient()
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Readiness query timed out.')), READINESS_TIMEOUT_MS)
      })
      await Promise.race([prisma.$queryRaw`SELECT 1`, timeout])
      return res.status(200).json({ success: true, message: 'Encore API and database are ready.' })
    } catch {
      return res.status(503).json({ success: false, message: 'Encore database readiness check failed.' })
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

module.exports = { createReadinessHandler, READINESS_TIMEOUT_MS }
