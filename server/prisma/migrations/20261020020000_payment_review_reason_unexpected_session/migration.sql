-- A verified paid event for a session that is not an Encore payment-mode session cannot be fulfilled
-- safely; it is recorded for review with this reason.
ALTER TABLE "payment_attempts" DROP CONSTRAINT "payment_attempts_review_reason_values_check";
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_review_reason_values_check" CHECK ("review_reason" IS NULL OR "review_reason" IN ('reservation_expired', 'reservation_cancelled', 'event_started', 'amount_mismatch', 'currency_mismatch', 'duplicate_payment', 'unexpected_session'));
