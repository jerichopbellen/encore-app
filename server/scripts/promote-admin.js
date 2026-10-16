const { getPrismaClient, disconnectPrisma } = require('../src/config/prisma')

const email = process.argv[2]

function isValidEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

async function promoteExistingAccount() {
  if (process.argv.length !== 3 || !isValidEmail(email)) {
    throw new Error('Provide exactly one valid email address for an existing account.')
  }

  const prisma = await getPrismaClient()
  const account = await prisma.users.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, role: true },
  })

  if (!account) {
    throw new Error('No account exists for that email address. Register the account first.')
  }

  if (account.role === 'admin') {
    console.log('That account already has the administrator role.')
    return
  }

  await prisma.users.update({
    where: { id: account.id },
    data: { role: 'admin' },
    select: { id: true },
  })
  console.log('Administrator role granted to the selected existing account.')
}

promoteExistingAccount()
  .catch((error) => {
    console.error(error.message.startsWith('Provide exactly one') || error.message.startsWith('No account exists')
      ? error.message
      : 'Could not promote the account. Check the server database configuration and try again.')
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await disconnectPrisma()
    } catch {
      console.error('Could not close the database connection cleanly.')
      process.exitCode = 1
    }
  })
