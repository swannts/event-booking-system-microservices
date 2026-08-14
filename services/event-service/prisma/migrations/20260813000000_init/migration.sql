CREATE TABLE "events" (
  "id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "date" TIMESTAMPTZ NOT NULL,
  "total_seats" INTEGER NOT NULL,
  "available_seats" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "processed_event_messages" (
  "message_id" TEXT NOT NULL,
  "processed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "processed_event_messages_pkey" PRIMARY KEY ("message_id")
);
