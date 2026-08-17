ALTER TYPE "OutboxStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "OutboxStatus" ADD VALUE 'FAILED';

ALTER TABLE "booking_outbox_events"
  ADD COLUMN "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "claimed_at" TIMESTAMPTZ,
  ADD COLUMN "claimed_by" TEXT;

CREATE INDEX "booking_outbox_events_status_next_attempt_at_created_at_idx"
  ON "booking_outbox_events"("status", "next_attempt_at", "created_at");
