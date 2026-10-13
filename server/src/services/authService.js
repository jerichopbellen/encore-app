const bcrypt = require('bcrypt')
const { getPrismaClient } = require('../config/prisma')

const safeUserFields = {
  id: true,
  name: true,
  email: true,
  role: true,
  created_at: true,
}

async function registerUser({ name, email, password }) {
  const prisma = await getPrismaClient()
  const password_hash = await bcrypt.hash(password, 12)

  return prisma.users.create({
    data: { name, email, password_hash },
    select: safeUserFields,
  })
}

async function findUserByEmail(email) {
  const prisma = await getPrismaClient()
  return prisma.users.findUnique({ where: { email } })
}

async function findSafeUserById(id) {
  const prisma = await getPrismaClient()
  return prisma.users.findUnique({
    where: { id },
    select: safeUserFields,
  })
}

async function updateUserName(id, name) {
  const prisma = await getPrismaClient()
  return prisma.users.update({
    where: { id },
    data: { name },
    select: safeUserFields,
  })
}

module.exports = { registerUser, findUserByEmail, findSafeUserById, updateUserName }
