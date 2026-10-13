export function formatEventDate(value, options) {
  return new Intl.DateTimeFormat('en-PH', options).format(new Date(value))
}

export function formatPrice(value) {
  const [whole, fraction = ''] = String(value).split('.')
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  return `₱${groupedWhole}.${fraction.padEnd(2, '0').slice(0, 2)}`
}

export function getStartingPrice(ticketTypes) {
  if (ticketTypes.length === 0) return null

  return ticketTypes.reduce((lowest, ticketType) => (
    Number(ticketType.price) < Number(lowest) ? ticketType.price : lowest
  ), ticketTypes[0].price)
}
