ALTER TABLE "booking_idempotency_keys"
  ADD COLUMN "request_fingerprint" TEXT;

UPDATE "booking_idempotency_keys" AS idempotency
SET "request_fingerprint" = concat(
  'v1:',
  lower(booking."user_id"::text),
  ':',
  lower(booking."event_id"::text),
  ':',
  booking."quantity"::text
)
FROM "bookings" AS booking
WHERE booking."id" = idempotency."booking_id";

ALTER TABLE "booking_idempotency_keys"
  ALTER COLUMN "request_fingerprint" SET NOT NULL;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_quantity_positive" CHECK ("quantity" > 0);
