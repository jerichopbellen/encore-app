async function lockTicketTypes(tx, ticketTypeIds) {
  const sortedIds = [...new Set(ticketTypeIds)].sort()
  for (const id of sortedIds) {
    // All inventory-changing workflows lock ticket rows in the same order.
    await tx.$queryRaw`SELECT id FROM ticket_types WHERE id = ${id}::uuid FOR UPDATE`
  }
}

async function getCommittedQuantity(tx, ticketTypeId, now) {
  const [row] = await tx.$queryRaw`
    SELECT COALESCE(SUM(item.quantity), 0)::bigint AS committed
    FROM reservation_items AS item
    INNER JOIN reservations AS reservation ON reservation.id = item.reservation_id
    LEFT JOIN bookings AS booking ON booking.reservation_id = reservation.id
    WHERE item.ticket_type_id = ${ticketTypeId}::uuid
      AND (
        (reservation.status = 'pending' AND reservation.expires_at > ${now})
        OR (reservation.status = 'confirmed' AND booking.status = 'confirmed')
      )
  `
  return row.committed
}

module.exports = { lockTicketTypes, getCommittedQuantity }
