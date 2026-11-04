// Encore limits how many pending reservations one account may hold. The shared
// fixture accounts in the integration suites would otherwise accumulate holds
// from earlier scenarios and hit that limit, so each scenario starts from a
// clean slate: leftover pending holds of the given accounts are cancelled and
// their tickets returned, exactly as a customer cancelling them would.
async function releasePendingHolds(prisma, userIds) {
  if (userIds.length === 0) return
  await prisma.$transaction(async (tx) => {
    const holds = await tx.reservations.findMany({
      where: { user_id: { in: userIds }, status: 'pending' },
      select: { id: true, reservation_items: { select: { ticket_type_id: true, quantity: true } } },
    })
    for (const hold of holds) {
      await tx.reservations.update({ where: { id: hold.id }, data: { status: 'cancelled' } })
      for (const item of hold.reservation_items) {
        await tx.ticket_types.update({
          where: { id: item.ticket_type_id },
          data: { available_quantity: { increment: item.quantity } },
        })
      }
    }
  })
}

module.exports = { releasePendingHolds }
