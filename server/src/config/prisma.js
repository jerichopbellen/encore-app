require('dotenv').config({
  path: require('path').resolve(__dirname, '../../.env'),
})

let prismaClientPromise

async function getPrismaClient() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is missing. Add it to server/.env using the existing PostgreSQL connection settings.',
    )
  }

  if (!prismaClientPromise) {
    // Prisma generates ESM TypeScript, so CommonJS loads it with import().
    prismaClientPromise = import('../generated/prisma/client.mts')
      .then(({ PrismaClient }) => {
        const { PrismaPg } = require('@prisma/adapter-pg')
        const adapter = new PrismaPg({
          connectionString: process.env.DATABASE_URL,
          max: 10,
          connectionTimeoutMillis: 5000,
        })

        return new PrismaClient({ adapter })
      })
      .catch((error) => {
        prismaClientPromise = undefined
        throw error
      })
  }

  return prismaClientPromise
}

async function disconnectPrisma() {
  if (prismaClientPromise) {
    const prismaClient = await prismaClientPromise
    await prismaClient.$disconnect()
    prismaClientPromise = undefined
  }
}

module.exports = { getPrismaClient, disconnectPrisma }
