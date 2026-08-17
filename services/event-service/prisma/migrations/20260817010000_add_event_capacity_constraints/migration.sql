ALTER TABLE "events"
  ADD CONSTRAINT "events_total_seats_positive" CHECK ("total_seats" > 0),
  ADD CONSTRAINT "events_available_seats_nonnegative" CHECK ("available_seats" >= 0),
  ADD CONSTRAINT "events_available_seats_not_above_total" CHECK ("available_seats" <= "total_seats");
