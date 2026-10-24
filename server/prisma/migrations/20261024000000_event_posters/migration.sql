-- AlterTable
-- Optional admin-uploaded Cloudinary poster. NULL keeps Encore's generated default poster.
-- Additive and nullable, so the previously deployed backend keeps working after this migration.
ALTER TABLE "events" ADD COLUMN "poster_public_id" VARCHAR(255),
ADD COLUMN "poster_url" TEXT;

-- CreateIndex
-- Every upload uses a fresh public ID, so one asset can belong to at most one event.
CREATE UNIQUE INDEX "events_poster_public_id_key" ON "events"("poster_public_id");

-- CreateTable
CREATE TABLE "event_poster_cleanups" (
    "public_id" VARCHAR(255) NOT NULL,
    "event_id" UUID NOT NULL,
    "reason" VARCHAR(20) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_poster_cleanups_pkey" PRIMARY KEY ("public_id")
);

-- CreateIndex
CREATE INDEX "event_poster_cleanups_created_at_idx" ON "event_poster_cleanups"("created_at");

-- Domain invariants that Prisma Schema Language cannot express.
ALTER TABLE "events" ADD CONSTRAINT "events_poster_pair_check" CHECK (("poster_public_id" IS NULL) = ("poster_url" IS NULL));
ALTER TABLE "event_poster_cleanups" ADD CONSTRAINT "event_poster_cleanups_reason_check" CHECK ("reason" IN ('pending_upload', 'detached'));
ALTER TABLE "event_poster_cleanups" ADD CONSTRAINT "event_poster_cleanups_attempts_check" CHECK ("attempts" >= 0);
