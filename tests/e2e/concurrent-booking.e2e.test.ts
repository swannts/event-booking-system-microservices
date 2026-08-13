import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "child_process";
import { randomUUID } from "crypto";

const ROOT_DIR = process.cwd();
const COMPOSE_CMD = ["compose"];
const POSTGRES_DB = "event_booking";
const TOTAL_SEATS = 10;
const CONCURRENT_REQUESTS = 100;

const Topics = {
  RESERVE_SEATS: "booking.reserve-seats",
  SEATS_RESERVED: "event.seats-reserved",
  SEAT_RESERVATION_FAILED: "event.seat-reservation-failed",
  RELEASE_SEATS: "booking.release-seats",
  BOOKING_CONFIRMED: "booking.confirmed",
  BOOKING_FAILED: "booking.failed",
  BOOKING_CANCELLED: "booking.cancelled"
} as const;

function compose(args: string[], options: { stdio?: "pipe" | "inherit" | "ignore" } = {}) {
  const output = execFileSync("docker", [...COMPOSE_CMD, ...args], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe"
  });

  return typeof output === "string" ? output.trim() : "";
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number, stepMs: number, failureMessage: string) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }

  throw new Error(failureMessage);
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  await waitFor(
    async () => {
      try {
        const response = await fetch(url);
        return response.ok;
      } catch {
        return false;
      }
    },
    timeoutMs,
    1000,
    `Timed out waiting for ${url}`
  );
}

async function waitForHealth(port: number): Promise<void> {
  await waitForHttp(`http://127.0.0.1:${port}/health/ready`, 180000);
}

async function waitForComposeServiceHealth(service: string, timeoutMs = 180000): Promise<void> {
  await waitFor(
    async () => {
      try {
        const containerId = compose(["ps", "-q", service]);
        if (!containerId) {
          return false;
        }

        const health = execFileSync("docker", ["inspect", "-f", "{{.State.Health.Status}}", containerId], {
          cwd: ROOT_DIR,
          encoding: "utf8"
        }).trim();
        return health === "healthy";
      } catch {
        return false;
      }
    },
    timeoutMs,
    1000,
    `Timed out waiting for ${service} to become healthy`
  );
}

function createKafkaTopicsCommand(): string {
  const topics = [
    Topics.RESERVE_SEATS,
    Topics.SEATS_RESERVED,
    Topics.SEAT_RESERVATION_FAILED,
    Topics.RELEASE_SEATS,
    Topics.BOOKING_CONFIRMED,
    Topics.BOOKING_FAILED,
    Topics.BOOKING_CANCELLED
  ];

  return topics
    .map(
      (topic) =>
        `/opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --create --if-not-exists --topic ${topic} --partitions 1 --replication-factor 1`
    )
    .join(" && ");
}

function createBookingSchemaSql(): string {
  return `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BookingStatus') THEN
        CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED', 'EXPIRED');
      END IF;
    END
    $$;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OutboxStatus') THEN
        CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED');
      END IF;
    END
    $$;

    CREATE TABLE IF NOT EXISTS "bookings" (
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

    CREATE UNIQUE INDEX IF NOT EXISTS "bookings_idempotency_key_key" ON "bookings"("idempotency_key");

    CREATE TABLE IF NOT EXISTS "booking_idempotency_keys" (
      "key" TEXT NOT NULL,
      "booking_id" UUID NOT NULL,
      "response" JSONB NOT NULL,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "booking_idempotency_keys_pkey" PRIMARY KEY ("key")
    );

    CREATE UNIQUE INDEX IF NOT EXISTS "booking_idempotency_keys_booking_id_key" ON "booking_idempotency_keys"("booking_id");

    CREATE TABLE IF NOT EXISTS "processed_booking_messages" (
      "message_id" UUID NOT NULL,
      "processed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "processed_booking_messages_pkey" PRIMARY KEY ("message_id")
    );

    CREATE TABLE IF NOT EXISTS "booking_outbox_events" (
      "id" UUID NOT NULL,
      "topic" TEXT NOT NULL,
      "message_id" TEXT NOT NULL,
      "message" JSONB NOT NULL,
      "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "last_error" TEXT,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "published_at" TIMESTAMPTZ,
      CONSTRAINT "booking_outbox_events_pkey" PRIMARY KEY ("id")
    );

    CREATE UNIQUE INDEX IF NOT EXISTS "booking_outbox_events_message_id_key" ON "booking_outbox_events"("message_id");

    TRUNCATE TABLE "booking_outbox_events", "processed_booking_messages", "booking_idempotency_keys", "bookings";
  `;
}

function createEventSchemaSql(): string {
  return `
    CREATE TABLE IF NOT EXISTS "events" (
      "id" UUID NOT NULL,
      "title" TEXT NOT NULL,
      "date" TIMESTAMPTZ NOT NULL,
      "total_seats" INTEGER NOT NULL,
      "available_seats" INTEGER NOT NULL,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "events_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE IF NOT EXISTS "processed_event_messages" (
      "message_id" UUID NOT NULL,
      "processed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "processed_event_messages_pkey" PRIMARY KEY ("message_id")
    );

    TRUNCATE TABLE "processed_event_messages", "events";
  `;
}

async function waitForAllBookingsSettled(bookingIds: string[], eventId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastStatuses = new Map<string, string>();
  let minAvailableSeats = Number.POSITIVE_INFINITY;

  while (Date.now() < deadline) {
    const responses = await Promise.all(
      bookingIds.map(async (bookingId) => {
        const response = await fetch(`http://127.0.0.1:3002/bookings/${bookingId}`);
        if (!response.ok) {
          return { bookingId, status: "UNAVAILABLE" };
        }

        const body = (await response.json()) as { status?: string };
        return { bookingId, status: body.status ?? "UNKNOWN" };
      })
    );

    lastStatuses = new Map(responses.map(({ bookingId, status }) => [bookingId, status]));
    const eventResponse = await fetch(`http://127.0.0.1:3001/events/${eventId}`);
    if (eventResponse.ok) {
      const event = (await eventResponse.json()) as { availableSeats?: number };
      if (event.availableSeats !== undefined) {
        minAvailableSeats = Math.min(minAvailableSeats, event.availableSeats);
      }
    }
    if ([...lastStatuses.values()].every((status) => status === "CONFIRMED" || status === "FAILED" || status === "CANCELLED")) {
      return { lastStatuses, minAvailableSeats };
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(
    `Timed out waiting for all bookings to settle. Last statuses: ${JSON.stringify(
      Object.fromEntries(lastStatuses)
    )}, minAvailableSeats=${minAvailableSeats}`
  );
}

async function waitForEventSeats(eventId: string, expectedSeats: number, timeoutMs: number): Promise<{ availableSeats: number }> {
  let lastEvent: { availableSeats?: number } | null = null;

  await waitFor(
    async () => {
      const response = await fetch(`http://127.0.0.1:3001/events/${eventId}`);
      if (!response.ok) {
        return false;
      }

      lastEvent = (await response.json()) as { availableSeats?: number };
      return lastEvent.availableSeats === expectedSeats;
    },
    timeoutMs,
    500,
    `Timed out waiting for event ${eventId} to report ${expectedSeats} available seats`
  );

  return lastEvent as { availableSeats: number };
}

async function waitForNotificationCount(expectedCount: number, timeoutMs: number): Promise<number> {
  let count = 0;

  await waitFor(
    async () => {
      const response = await fetch("http://127.0.0.1:3003/notifications");
      if (!response.ok) {
        return false;
      }

      const notifications = (await response.json()) as Array<{ type?: string }>;
      count = notifications.length;
      return notifications.length >= expectedCount;
    },
    timeoutMs,
    500,
    `Timed out waiting for at least ${expectedCount} notifications`
  );

  return count;
}

describe("concurrent booking e2e", () => {
  beforeAll(async () => {
    compose(["up", "-d", "--build", "user-db", "event-db", "booking-db", "redis", "kafka"], { stdio: "inherit" });

    await waitForComposeServiceHealth("user-db");
    await waitForComposeServiceHealth("event-db");
    await waitForComposeServiceHealth("booking-db");
    await waitForComposeServiceHealth("redis");
    await waitForComposeServiceHealth("kafka");

    compose(["exec", "-T", "kafka", "sh", "-lc", createKafkaTopicsCommand()], { stdio: "inherit" });
    compose(["exec", "-T", "event-db", "psql", "-U", "postgres", "-d", POSTGRES_DB, "-v", "ON_ERROR_STOP=1", "-c", createEventSchemaSql()], {
      stdio: "inherit"
    });
    compose(["exec", "-T", "booking-db", "psql", "-U", "postgres", "-d", POSTGRES_DB, "-v", "ON_ERROR_STOP=1", "-c", createBookingSchemaSql()], {
      stdio: "inherit"
    });

    compose(["up", "-d", "--build", "user-service", "event-service", "booking-service", "notification-service"], {
      stdio: "inherit"
    });

    await waitForHealth(3000);
    await waitForHealth(3001);
    await waitForHealth(3002);
    await waitForHealth(3003);
  }, 300000);

  afterAll(async () => {
    spawnSync("docker", ["compose", "down", "-v", "--remove-orphans"], {
      cwd: ROOT_DIR,
      stdio: "inherit"
    });
  }, 300000);

  it(
    "confirms exactly 10 out of 100 concurrent booking requests without overselling",
    async () => {
      const userResponse = await fetch("http://127.0.0.1:3000/users", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Concurrency Tester",
          email: `concurrency-${randomUUID()}@example.com`
        })
      });
      expect(userResponse.ok).toBe(true);
      const user = (await userResponse.json()) as { id: string };

      const eventResponse = await fetch("http://127.0.0.1:3001/events", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          title: "Concurrency Test Event",
          date: "2026-09-20T10:00:00.000Z",
          totalSeats: TOTAL_SEATS
        })
      });
      expect(eventResponse.ok).toBe(true);
      const event = (await eventResponse.json()) as { id: string };

      const bookingRequests = Array.from({ length: CONCURRENT_REQUESTS }, () => {
        const idempotencyKey = randomUUID();
        return fetch("http://127.0.0.1:3002/bookings", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey
          },
          body: JSON.stringify({
            userId: user.id,
            eventId: event.id,
            quantity: 1
          })
        }).then(async (response) => {
          if (!response.ok && response.status !== 201) {
            const text = await response.text();
            throw new Error(`Booking request failed with status ${response.status}: ${text}`);
          }

          return (await response.json()) as { id: string; status: string };
        });
      });

      const bookingResponses = await Promise.all(bookingRequests);
      expect(bookingResponses).toHaveLength(CONCURRENT_REQUESTS);
      expect(bookingResponses.every((booking) => booking.status === "PENDING")).toBe(true);

      const bookingIds = bookingResponses.map((booking) => booking.id);
      const settlement = await waitForAllBookingsSettled(bookingIds, event.id, 180000);

      const settledResponses = await Promise.all(
        bookingIds.map(async (bookingId) => {
          const response = await fetch(`http://127.0.0.1:3002/bookings/${bookingId}`);
          expect(response.ok).toBe(true);
          return response.json() as Promise<{ status: string }>;
        })
      );

      const confirmed = settledResponses.filter((booking) => booking.status === "CONFIRMED").length;
      const failed = settledResponses.filter((booking) => booking.status === "FAILED").length;
      const pending = settledResponses.filter((booking) => booking.status === "PENDING").length;

      if (settlement.minAvailableSeats < 0) {
        throw new Error(`availableSeats became negative during polling: ${settlement.minAvailableSeats}`);
      }

      expect(confirmed).toBe(10);
      expect(failed).toBe(90);
      expect(pending).toBe(0);

      const eventDetails = await waitForEventSeats(event.id, 0, 180000);
      expect(eventDetails.availableSeats).toBe(0);

      const notificationsCount = await waitForNotificationCount(10, 180000);
      expect(notificationsCount).toBeGreaterThanOrEqual(10);
    },
    300000
  );
});
