-- AlterTable
-- Immutable description of what the Stripe Checkout Session shows (name, unit amount, quantity per line).
-- It is saved with the attempt so a retried session creation sends byte-identical parameters even if an
-- administrator renames the event or ticket type afterwards.
ALTER TABLE "payment_attempts" ADD COLUMN "checkout_items" JSONB NOT NULL DEFAULT '[]';

-- Domain invariant that Prisma Schema Language cannot express.
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_checkout_items_check" CHECK (jsonb_typeof("checkout_items") = 'array');
