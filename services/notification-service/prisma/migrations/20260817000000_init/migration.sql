CREATE TYPE "NotificationType" AS ENUM ('BOOKING_CONFIRMED', 'BOOKING_FAILED', 'BOOKING_CANCELLED');

CREATE TABLE "notifications" (
  "id" UUID NOT NULL,
  "type" "NotificationType" NOT NULL,
  "message_id" UUID NOT NULL,
  "correlation_id" UUID NOT NULL,
  "booking_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "message" TEXT NOT NULL,
  "reason" TEXT,
  "occurred_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notifications_message_id_key" ON "notifications"("message_id");
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

CREATE TABLE "processed_notification_messages" (
  "message_id" UUID NOT NULL,
  "processed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "processed_notification_messages_pkey" PRIMARY KEY ("message_id")
);
