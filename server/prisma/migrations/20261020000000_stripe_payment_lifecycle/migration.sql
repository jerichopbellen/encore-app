-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL DEFAULT 'stripe',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
    "status" VARCHAR(20) NOT NULL DEFAULT 'creating',
    "stripe_checkout_session_id" VARCHAR(255),
    "stripe_payment_intent_id" VARCHAR(255),
    "checkout_url" TEXT,
    "booking_id" UUID,
    "review_reason" VARCHAR(40),
    "session_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_webhook_events" (
    "id" VARCHAR(255) NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "outcome" VARCHAR(20) NOT NULL,
    "payment_attempt_id" UUID,
    "stripe_created_at" TIMESTAMPTZ(6) NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Lets payment_attempts reference a booking together with its own reservation.
CREATE UNIQUE INDEX "bookings_id_reservation_id_key" ON "bookings"("id", "reservation_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_stripe_checkout_session_id_key" ON "payment_attempts"("stripe_checkout_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_booking_id_key" ON "payment_attempts"("booking_id");

-- CreateIndex
CREATE INDEX "payment_attempts_reservation_id_idx" ON "payment_attempts"("reservation_id");

-- CreateIndex
CREATE INDEX "payment_attempts_user_id_idx" ON "payment_attempts"("user_id");

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
-- MATCH SIMPLE: not enforced while booking_id is NULL. Once set, the booking must belong to this attempt's reservation.
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_booking_id_reservation_id_fkey" FOREIGN KEY ("booking_id", "reservation_id") REFERENCES "bookings"("id", "reservation_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Domain invariants that Prisma Schema Language cannot express.
-- At most one live attempt per reservation: stops duplicate Stripe sessions and duplicate payment attempts.
CREATE UNIQUE INDEX "payment_attempts_one_live_per_reservation_key" ON "payment_attempts"("reservation_id") WHERE "status" IN ('creating', 'open');

ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_provider_check" CHECK ("provider" = 'stripe');
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_currency_check" CHECK ("currency" = 'PHP');
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_amount_positive_check" CHECK ("amount" > 0);
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_status_check" CHECK ("status" IN ('creating', 'open', 'fulfilled', 'needs_review', 'expired', 'failed'));
-- A hosted Checkout Session exists once the attempt is open or has recorded a payment.
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_session_required_check" CHECK ("status" NOT IN ('open', 'fulfilled', 'needs_review') OR "stripe_checkout_session_id" IS NOT NULL);
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_open_url_check" CHECK ("status" <> 'open' OR "checkout_url" IS NOT NULL);
-- Only a fulfilled attempt has a booking, and a recorded payment always has paid_at.
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_booking_iff_fulfilled_check" CHECK (("status" = 'fulfilled') = ("booking_id" IS NOT NULL));
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_paid_at_check" CHECK (("status" IN ('fulfilled', 'needs_review')) = ("paid_at" IS NOT NULL));
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_review_reason_check" CHECK (("status" = 'needs_review') = ("review_reason" IS NOT NULL));
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_review_reason_values_check" CHECK ("review_reason" IS NULL OR "review_reason" IN ('reservation_expired', 'reservation_cancelled', 'event_started', 'amount_mismatch', 'currency_mismatch', 'duplicate_payment'));
ALTER TABLE "stripe_webhook_events" ADD CONSTRAINT "stripe_webhook_events_outcome_check" CHECK ("outcome" IN ('processed', 'ignored', 'unmatched', 'needs_review'));
