const MAX_INT = 2_147_483_647

// A capacity edit reserves space for active holds and confirmed purchases first.
// null means the requested total is below committed inventory.
function calculateAvailableQuantity(totalQuantity, committedQuantity) {
  const total = BigInt(totalQuantity)
  const committed = BigInt(committedQuantity)
  if (total < 0n || committed < 0n || total > BigInt(MAX_INT)) {
    throw new RangeError('Ticket quantities must be within the PostgreSQL integer range.')
  }
  if (total < committed) return null
  return Number(total - committed)
}

module.exports = { calculateAvailableQuantity }
