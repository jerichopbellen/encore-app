function serializeEvent(event) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    venue: event.venue,
    starts_at: event.starts_at.toISOString(),
    status: event.status,
    // null means the event uses Encore's generated default poster.
    poster_url: event.poster_url ?? null,
    ticket_types: (event.ticket_types || []).map((ticketType) => ({
      id: ticketType.id,
      name: ticketType.name,
      price: ticketType.price.toFixed(2),
      total_quantity: ticketType.total_quantity,
      available_quantity: ticketType.available_quantity,
    })),
  }
}

// Admins also receive the poster's public ID, which they send back as the
// expected_poster precondition when replacing or removing it.
function serializeAdminEvent(event) {
  return { ...serializeEvent(event), poster_public_id: event.poster_public_id ?? null }
}

module.exports = { serializeEvent, serializeAdminEvent }
