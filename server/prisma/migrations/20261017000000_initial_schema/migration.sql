-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'confirmed',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "venue" VARCHAR(200) NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "operation" VARCHAR(50) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservation_id" UUID NOT NULL,
    "ticket_type_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "reservation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "total_quantity" INTEGER NOT NULL,
    "available_quantity" INTEGER NOT NULL,

    CONSTRAINT "ticket_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'customer',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_reservation_id_key" ON "bookings"("reservation_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_id_operation_idempotency_key_key" ON "idempotency_keys"("user_id", "operation", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "reservation_items_reservation_id_ticket_type_id_key" ON "reservation_items"("reservation_id", "ticket_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_types_event_id_name_key" ON "ticket_types"("event_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_ticket_type_id_fkey" FOREIGN KEY ("ticket_type_id") REFERENCES "ticket_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Keep the domain invariants that Prisma Schema Language cannot express.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_total_amount_nonnegative_check" CHECK ("total_amount" >= 0);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_status_check" CHECK ("status" = 'confirmed');
ALTER TABLE "events" ADD CONSTRAINT "events_status_check" CHECK ("status" IN ('draft', 'published'));
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_quantity_positive_check" CHECK ("quantity" > 0);
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_unit_price_positive_check" CHECK ("unit_price" > 0);
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_status_check" CHECK ("status" IN ('pending', 'confirmed', 'cancelled', 'expired'));
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_price_positive_check" CHECK ("price" > 0);
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_total_quantity_nonnegative_check" CHECK ("total_quantity" >= 0);
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_available_quantity_nonnegative_check" CHECK ("available_quantity" >= 0);
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_available_within_capacity_check" CHECK ("available_quantity" <= "total_quantity");
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('customer', 'admin'));
