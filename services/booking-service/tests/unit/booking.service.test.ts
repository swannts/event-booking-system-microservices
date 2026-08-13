import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createBookingApp } from "../../src/app";
import type { BookingDatabaseClient } from "../../src/modules/bookings/booking.repository";
import type { MessagePublisher } from "../../src/infrastructure/messaging/message-publisher";
import type { BookingStatus } from "@event-booking/contracts";

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

type ProcessedMessageRow = {
  messageId: string;
  processedAt: Date;
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

class FakeBookingDatabase implements BookingDatabaseClient {
  public readonly bookings = new Map<string, BookingRow>();
  public readonly idempotencyKeys = new Map<string, IdempotencyRow>();
  public readonly processedMessages = new Map<string, ProcessedMessageRow>();
  public readonly outboxEvents = new Map<string, OutboxRow>();

  public readonly booking = {
    create: async ({ data }: { data: Omit<BookingRow, "createdAt" | "updatedAt"> }) => {
      const now = new Date("2026-08-13T00:00:00.000Z");
      const row: BookingRow = {
        ...data,
        createdAt: now,
        updatedAt: now
      };
      this.bookings.set(row.id, row);
      return row;
    },
    findUnique: async ({ where }: { where: { id?: string; idempotencyKey?: string } }) => {
      if (where.id) {
        return this.bookings.get(where.id) ?? null;
      }

      if (where.idempotencyKey) {
        const booking = [...this.bookings.values()].find((row) => row.idempotencyKey === where.idempotencyKey);
        return booking ?? null;
      }

      return null;
    },
    findMany: async (input?: { where?: { userId?: string }; orderBy?: { createdAt?: "asc" | "desc" } }) => {
      const rows = [...this.bookings.values()].filter((row) =>
        input?.where?.userId ? row.userId === input.where.userId : true
      );

      rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
      return input?.orderBy?.createdAt === "desc" ? rows.reverse() : rows;
    },
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
    findUnique: async ({ where }: { where: { key: string } }) => {
      return this.idempotencyKeys.get(where.key) ?? null;
    },
    create: async ({
      data
    }: {
      data: {
        key: string;
        bookingId: string;
        response: unknown;
      };
    }) => {
      const row: IdempotencyRow = {
        key: data.key,
        bookingId: data.bookingId,
        response: data.response,
        createdAt: new Date("2026-08-13T00:00:00.000Z")
      };
      this.idempotencyKeys.set(row.key, row);
      return row;
    },
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
        ? {
            ...existing,
            ...update
          }
        : {
            key: create.key,
            bookingId: create.bookingId,
            response: create.response,
            createdAt: new Date("2026-08-13T00:00:00.000Z")
          };

      this.idempotencyKeys.set(where.key, row);
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
      const now = new Date("2026-08-13T00:00:00.000Z");
      const row: OutboxRow = {
        id: data.id,
        topic: data.topic,
        messageId: data.messageId,
        message: data.message,
        status: data.status,
        attempts: data.attempts,
        lastError: data.lastError,
        createdAt: now,
        updatedAt: now,
        publishedAt: data.publishedAt
      };
      this.outboxEvents.set(row.id, row);
      return row;
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      return this.outboxEvents.get(where.id) ?? null;
    },
    findMany: async (input?: { where?: { status?: "PENDING" | "PUBLISHED" }; orderBy?: { createdAt?: "asc" | "desc" }; take?: number }) => {
      let rows = [...this.outboxEvents.values()];
      if (input?.where?.status) {
        rows = rows.filter((row) => row.status === input.where.status);
      }
      rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
      if (input?.take !== undefined) {
        rows = rows.slice(0, input.take);
      }
      return input?.orderBy?.createdAt === "desc" ? rows.reverse() : rows;
    },
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

  public readonly processedBookingMessage = {
    findUnique: async ({ where }: { where: { messageId: string } }) => {
      return this.processedMessages.get(where.messageId) ?? null;
    },
    upsert: async ({
      where,
      create
    }: {
      where: { messageId: string };
      update: Record<string, never>;
      create: { messageId: string };
    }) => {
      const row: ProcessedMessageRow = this.processedMessages.get(where.messageId) ?? {
        messageId: create.messageId,
        processedAt: new Date("2026-08-13T00:00:00.000Z")
      };
      this.processedMessages.set(where.messageId, row);
      return row;
    }
  };

  async $connect() {}

  async $disconnect() {}

  async $transaction<T>(fn: (client: BookingDatabaseClient) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

class FakePublisher implements MessagePublisher {
  public published: Array<{ topic: string; message: unknown }> = [];

  async publish<TPayload>(topic: string, message: { payload: TPayload }) {
    this.published.push({ topic, message });
  }
}

async function createTestApp() {
  const db = new FakeBookingDatabase();
  const publisher = new FakePublisher();
  const app = await createBookingApp({ db, publisher });
  return { app, publisher, db };
}

describe("Booking Service", () => {
  let app: Awaited<ReturnType<typeof createBookingApp>>;
  let publisher: FakePublisher;

  beforeEach(async () => {
    const created = await createTestApp();
    app = created.app;
    publisher = created.publisher;
  });

  it("creates a pending booking and publishes reserve seats", async () => {
    const res = await request(app)
      .post("/bookings")
      .set("x-request-id", "req-123")
      .send({
        userId: "550e8400-e29b-41d4-a716-446655440000",
        eventId: "550e8400-e29b-41d4-a716-446655440001",
        quantity: 2
      })
      .expect(201);

    expect(res.body.status).toBe("PENDING");
    expect(res.headers["x-request-id"]).toBe("req-123");
    expect(publisher.published[0]?.topic).toBe("booking.reserve-seats");
  });

  it("returns the same booking for the same idempotency key", async () => {
    const input = {
      userId: "550e8400-e29b-41d4-a716-446655440000",
      eventId: "550e8400-e29b-41d4-a716-446655440001",
      quantity: 2
    };

    const first = await request(app).post("/bookings").set("Idempotency-Key", "abc").send(input).expect(201);
    const second = await request(app).post("/bookings").set("Idempotency-Key", "abc").send(input).expect(201);

    expect(second.body.id).toBe(first.body.id);
  });

  it("rejects cancellation of a non-confirmed booking", async () => {
    const created = await request(app)
      .post("/bookings")
      .send({
        userId: "550e8400-e29b-41d4-a716-446655440000",
        eventId: "550e8400-e29b-41d4-a716-446655440001",
        quantity: 2
      })
      .expect(201);

    await request(app).post(`/bookings/${created.body.id}/cancel`).expect(409);
  });
});
