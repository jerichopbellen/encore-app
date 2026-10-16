function serializeEvent(event) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    venue: event.venue,
    starts_at: event.starts_at.toISOString(),
    status: event.status,
    ticket_types: (event.ticket_types || []).map((ticketType) => ({
      id: ticketType.id,
      name: ticketType.name,
      price: ticketType.price.toFixed(2),
      total_quantity: ticketType.total_quantity,
      available_quantity: ticketType.available_quantity,
    })),
  }
}

module.exports = { serializeEvent }
