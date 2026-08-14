CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED', 'EXPIRED');

CREATE TABLE "bookings" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" "BookingStatus" NOT NULL,
  "idempotency_key" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bookings_idempotency_key_key" ON "bookings"("idempotency_key");

CREATE TABLE "booking_idempotency_keys" (
  "key" TEXT NOT NULL,
  "booking_id" UUID NOT NULL,
  "response" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "booking_idempotency_keys_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "booking_idempotency_keys_booking_id_key" ON "booking_idempotency_keys"("booking_id");

CREATE TABLE "processed_booking_messages" (
  "message_id" TEXT NOT NULL,
  "processed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "processed_booking_messages_pkey" PRIMARY KEY ("message_id")
);
