import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { Topics, type BookingStatus, type MessageEnvelope, type ReserveSeatsPayload } from "@event-booking/contracts";
import { PrismaBookingRepository, type BookingDatabaseClient } from "../../src/modules/bookings/booking.repository";

type BookingRow = {
  id: string;
  userId: string;
  eventId: string;
  quantity: number;
  status: BookingStatus;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type IdempotencyRow = {
  key: string;
  bookingId: string;
  response: unknown;
  createdAt: Date;
};

type OutboxRow = {
  id: string;
  topic: string;
  messageId: string;
  message: unknown;
  status: "PENDING" | "PUBLISHED";
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
};

function createEnvelope(bookingId: string, eventId: string, userId: string, quantity: number): MessageEnvelope<ReserveSeatsPayload> {
  return {
    messageId: randomUUID(),
    correlationId: bookingId,
    timestamp: new Date().toISOString(),
    version: 1,
    eventId,
    payload: {
      bookingId,
      eventId,
      userId,
      quantity
    }
  };
}

class FakeBookingDatabase implements BookingDatabaseClient {
  public readonly bookings = new Map<string, BookingRow>();
  public readonly idempotencyKeys = new Map<string, IdempotencyRow>();
  public readonly outboxEvents = new Map<string, OutboxRow>();
  public readonly processedMessages = new Map<string, { messageId: string; processedAt: Date }>();

  public readonly booking = {
    create: async ({ data }: { data: Omit<BookingRow, "createdAt" | "updatedAt"> }) => {
      const row: BookingRow = {
        ...data,
        createdAt: new Date("2026-08-13T00:00:00.000Z"),
        updatedAt: new Date("2026-08-13T00:00:00.000Z")
      };
      this.bookings.set(row.id, row);
      return row;
    },
    findUnique: async ({ where }: { where: { id?: string; idempotencyKey?: string } }) => {
      if (where.id) {
        return this.bookings.get(where.id) ?? null;
      }

      if (where.idempotencyKey) {
        return [...this.bookings.values()].find((row) => row.idempotencyKey === where.idempotencyKey) ?? null;
      }

      return null;
    },
    findMany: async () => [...this.bookings.values()],
    update: async ({
      where,
      data
    }: {
      where: { id: string };
      data: Partial<{ status: BookingStatus; updatedAt: Date }>;
    }) => {
      const row = this.bookings.get(where.id);
      if (!row) {
        throw new Error("Record not found");
      }

      const updated: BookingRow = {
        ...row,
        ...data,
        updatedAt: new Date("2026-08-13T00:00:00.000Z")
      };
      this.bookings.set(where.id, updated);
      return updated;
    }
  };

  public readonly bookingIdempotencyKey = {
    findUnique: async ({ where }: { where: { key: string } }) => this.idempotencyKeys.get(where.key) ?? null,
    upsert: async ({
      where,
      update,
      create
    }: {
      where: { key: string };
      update: { bookingId: string; response: unknown };
      create: { key: string; bookingId: string; response: unknown };
    }) => {
      const existing = this.idempotencyKeys.get(where.key);
      const row: IdempotencyRow = existing
        ? { ...existing, ...update }
        : {
            key: create.key,
            bookingId: create.bookingId,
            response: create.response,
            createdAt: new Date("2026-08-13T00:00:00.000Z")
          };

      this.idempotencyKeys.set(row.key, row);
      return row;
    },
    create: async ({ data }: { data: { key: string; bookingId: string; response: unknown } }) => {
      const row: IdempotencyRow = {
        key: data.key,
        bookingId: data.bookingId,
        response: data.response,
        createdAt: new Date("2026-08-13T00:00:00.000Z")
      };
      this.idempotencyKeys.set(row.key, row);
      return row;
    }
  };

  public readonly processedBookingMessage = {
    findUnique: async ({ where }: { where: { messageId: string } }) =>
      this.processedMessages.get(where.messageId) ?? null,
    upsert: async ({
      where,
      create
    }: {
      where: { messageId: string };
      update: Record<string, never>;
      create: { messageId: string };
    }) => {
      const row = this.processedMessages.get(where.messageId) ?? {
        messageId: create.messageId,
        processedAt: new Date("2026-08-13T00:00:00.000Z")
      };
      this.processedMessages.set(where.messageId, row);
      return row;
    }
  };

  public readonly bookingOutboxEvent = {
    create: async ({
      data
    }: {
      data: {
        id: string;
        topic: string;
        messageId: string;
        message: unknown;
        status: "PENDING" | "PUBLISHED";
        attempts: number;
        lastError: string | null;
        publishedAt: Date | null;
      };
    }) => {
      const row: OutboxRow = {
        id: data.id,
        topic: data.topic,
        messageId: data.messageId,
        message: data.message,
        status: data.status,
        attempts: data.attempts,
        lastError: data.lastError,
        createdAt: new Date("2026-08-13T00:00:00.000Z"),
        updatedAt: new Date("2026-08-13T00:00:00.000Z"),
        publishedAt: data.publishedAt
      };
      this.outboxEvents.set(row.id, row);
      return row;
    },
    findUnique: async ({ where }: { where: { id: string } }) => this.outboxEvents.get(where.id) ?? null,
    findMany: async () => [...this.outboxEvents.values()],
    update: async ({
      where,
      data
    }: {
      where: { id: string };
      data: Partial<{
        status: "PENDING" | "PUBLISHED";
        attempts: number;
        lastError: string | null;
        publishedAt: Date | null;
        updatedAt: Date;
      }>;
    }) => {
      const row = this.outboxEvents.get(where.id);
      if (!row) {
        throw new Error("Record not found");
      }

      const updated: OutboxRow = {
        ...row,
        ...data,
        updatedAt: new Date("2026-08-13T00:00:00.000Z")
      };
      this.outboxEvents.set(where.id, updated);
      return updated;
    }
  };

  async $connect() {}
  async $disconnect() {}
  async $transaction<T>(fn: (client: BookingDatabaseClient) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

describe("PrismaBookingRepository", () => {
  it("creates booking, idempotency, and outbox rows in one transaction", async () => {
    const db = new FakeBookingDatabase();
    const repository = new PrismaBookingRepository(db);
    const bookingId = randomUUID();
    const envelope = createEnvelope(bookingId, "event-1", "user-1", 2);

    const booking = await repository.createBookingWithOutbox(
      {
        id: bookingId,
        userId: "user-1",
        eventId: "event-1",
        quantity: 2,
        status: "PENDING",
        idempotencyKey: "idempotency-key-1"
      },
      {
        id: randomUUID(),
        topic: Topics.RESERVE_SEATS,
        message: envelope
      }
    );

    expect(booking.id).toBe(bookingId);
    expect(db.bookings.has(bookingId)).toBe(true);
    expect(db.idempotencyKeys.get("idempotency-key-1")?.bookingId).toBe(bookingId);
    expect(db.outboxEvents.size).toBe(1);
    expect([...db.outboxEvents.values()][0]?.topic).toBe(Topics.RESERVE_SEATS);
  });

  it("cancels booking and appends a cancellation outbox row", async () => {
    const db = new FakeBookingDatabase();
    const repository = new PrismaBookingRepository(db);
    const bookingId = randomUUID();
    db.bookings.set(bookingId, {
      id: bookingId,
      userId: "user-1",
      eventId: "event-1",
      quantity: 2,
      status: "CONFIRMED",
      idempotencyKey: null,
      createdAt: new Date("2026-08-13T00:00:00.000Z"),
      updatedAt: new Date("2026-08-13T00:00:00.000Z")
    });

    const cancelled = await repository.cancelBookingWithOutbox({
      id: bookingId,
      outbox: {
        id: randomUUID(),
        topic: Topics.BOOKING_CANCELLED,
        message: {
          messageId: randomUUID(),
          correlationId: bookingId,
          timestamp: new Date().toISOString(),
          version: 1,
          eventId: "event-1",
          payload: {
            bookingId,
            eventId: "event-1",
            quantity: 2
          }
        }
      }
    });

    expect(cancelled?.status).toBe("CANCELLED");
    expect(db.bookings.get(bookingId)?.status).toBe("CANCELLED");
    expect(db.outboxEvents.size).toBe(1);
    expect([...db.outboxEvents.values()][0]?.topic).toBe(Topics.BOOKING_CANCELLED);
  });
});
