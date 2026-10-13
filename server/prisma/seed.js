
const {
  getPrismaClient,
  disconnectPrisma,
} = require('../src/config/prisma')

const events = [
  {
    id: 'a1000000-0000-4000-8000-000000000001',
    title: 'Neon Nights Live',
    description: 'An energetic night of live music and performances.',
    venue: 'SM Mall of Asia Arena',
    daysFromNow: 14,
    tickets: [
      { name: 'General Admission', price: '1500.00', quantity: 500 },
      { name: 'VIP', price: '3500.00', quantity: 100 },
    ],
  },
  {
    id: 'a1000000-0000-4000-8000-000000000002',
    title: 'Indie Sound Festival',
    description: 'A festival celebrating independent music.',
    venue: 'Filinvest City Event Grounds',
    daysFromNow: 30,
    tickets: [
      { name: 'General Admission', price: '1200.00', quantity: 800 },
      { name: 'VIP', price: '2800.00', quantity: 150 },
    ],
  },
  {
    id: 'a1000000-0000-4000-8000-000000000003',
    title: 'The Grand Orchestra',
    description: 'An evening of orchestral music and cinematic scores.',
    venue: 'Philippine International Convention Center',
    daysFromNow: 45,
    tickets: [
      { name: 'Standard', price: '1000.00', quantity: 300 },
      { name: 'Premium', price: '2200.00', quantity: 80 },
    ],
  },
]

async function seedEvents() {
  const prisma = await getPrismaClient()

  for (const event of events) {
    const startsAt = new Date(
      Date.now() + event.daysFromNow * 24 * 60 * 60 * 1000,
    )

    await prisma.events.upsert({
      where: { id: event.id },
      create: {
        id: event.id,
        title: event.title,
        description: event.description,
        venue: event.venue,
        starts_at: startsAt,
        status: 'published',
      },
      update: {
        title: event.title,
        description: event.description,
        venue: event.venue,
        starts_at: startsAt,
        status: 'published',
      },
    })

    for (const ticket of event.tickets) {
      await prisma.ticket_types.upsert({
        where: {
          event_id_name: {
            event_id: event.id,
            name: ticket.name,
          },
        },
        create: {
          event_id: event.id,
          name: ticket.name,
          price: ticket.price,
          total_quantity: ticket.quantity,
          available_quantity: ticket.quantity,
        },
        update: {
          price: ticket.price,
          total_quantity: ticket.quantity,
        },
      })
    }

    console.log(`Seeded event: ${event.title}`)
  }
}

seedEvents()
  .catch((error) => {
    console.error('Failed to seed events:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectPrisma()
  })
