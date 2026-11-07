-- Database-level defense in depth for the per-reservation ticket limit.
-- The application already rejects quantities above 6 (MAX_TICKETS_PER_RESERVATION in
-- server/src/validators/reservationValidator.js); this makes PostgreSQL refuse them as well.
-- The range check replaces the earlier "quantity > 0" check, so the lower bound is unchanged.
-- The new constraint is added first and the old one dropped only afterwards: if any existing row
-- has a quantity above 6 the ADD fails and the old constraint is never touched.

-- Domain invariant that Prisma Schema Language cannot express.
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_quantity_range_check" CHECK ("quantity" BETWEEN 1 AND 6);

ALTER TABLE "reservation_items" DROP CONSTRAINT "reservation_items_quantity_positive_check";
