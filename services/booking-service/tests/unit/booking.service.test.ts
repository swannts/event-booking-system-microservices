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
  requestFingerprint: string;
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
    findMany: async (input?: {
      where?: { userId?: string };
      orderBy?: { createdAt?: "asc" | "desc" };
      skip?: number;
      take?: number;
    }) => {
      const rows = [...this.bookings.values()].filter((row) =>
        input?.where?.userId ? row.userId === input.where.userId : true
      );

      rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
      const ordered = input?.orderBy?.createdAt === "desc" ? rows.reverse() : rows;
      return ordered.slice(input?.skip ?? 0, (input?.skip ?? 0) + (input?.take ?? 20));
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
    },
    updateMany: async ({
      where,
      data
    }: {
      where: Partial<{ id: string; status: BookingStatus; eventId: string; quantity: number }>;
      data: Partial<{ status: BookingStatus; updatedAt: Date }>;
    }) => {
      const row = [...this.bookings.values()].find((entry) => {
        if (where.id && entry.id !== where.id) return false;
        if (where.status && entry.status !== where.status) return false;
        if (where.eventId && entry.eventId !== where.eventId) return false;
        if (where.quantity !== undefined && entry.quantity !== where.quantity) return false;
        return true;
      });

      if (!row) {
        return { count: 0 };
      }

      const updated: BookingRow = {
        ...row,
        ...data,
        updatedAt: new Date("2026-08-13T00:00:00.000Z")
      };
      this.bookings.set(row.id, updated);
      return { count: 1 };
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
        requestFingerprint: string;
        response: unknown;
      };
    }) => {
      const row: IdempotencyRow = {
        key: data.key,
        bookingId: data.bookingId,
        requestFingerprint: data.requestFingerprint,
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
      update: { bookingId: string; requestFingerprint?: string; response: unknown };
      create: { key: string; bookingId: string; requestFingerprint: string; response: unknown };
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
            requestFingerprint: create.requestFingerprint,
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
    findMany: async (input?: {
      where?: { status?: "PENDING" | "PUBLISHED" };
      orderBy?: { createdAt?: "asc" | "desc" };
      take?: number;
    }) => {
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
    create: async ({ data }: { data: { messageId: string } }) => {
      if (this.processedMessages.has(data.messageId)) {
        const error = new Error("Unique constraint failed");
        (error as { code?: string }).code = "P2002";
        throw error;
      }

      const row: ProcessedMessageRow = {
        messageId: data.messageId,
        processedAt: new Date("2026-08-13T00:00:00.000Z")
      };
      this.processedMessages.set(data.messageId, row);
      return row;
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

  async $queryRaw<T>(): Promise<T> {
    return [] as T;
  }

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
  const outboxDispatcher = {
    dispatchPending: async () => {
      for (const row of db.outboxEvents.values()) {
        if (row.status === "PENDING") {
          await publisher.publish(row.topic, row.message as { payload: unknown });
          row.status = "PUBLISHED";
          row.publishedAt = new Date();
        }
      }
    }
  };
  const app = await createBookingApp({ db, publisher, outboxDispatcher: outboxDispatcher as never });
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
    expect((await request(app).get("/metrics").expect(200)).text).toContain(
      'operation="booking_created",outcome="success"'
    );
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

  it.each([
    ["quantity", { quantity: 3 }],
    ["event", { eventId: "550e8400-e29b-41d4-a716-446655440002" }],
    ["user", { userId: "550e8400-e29b-41d4-a716-446655440003" }]
  ])("rejects an idempotency key reused with a different %s", async (_field, change) => {
    const input = {
      userId: "550e8400-e29b-41d4-a716-446655440000",
      eventId: "550e8400-e29b-41d4-a716-446655440001",
      quantity: 2
    };

    await request(app).post("/bookings").set("Idempotency-Key", "reused-key").send(input).expect(201);
    const response = await request(app)
      .post("/bookings")
      .set("Idempotency-Key", "reused-key")
      .send({ ...input, ...change })
      .expect(409);

    expect(response.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
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

  it("uses bounded pagination for a user's bookings", async () => {
    const created = await createTestApp();
    const payload = {
      userId: "550e8400-e29b-41d4-a716-446655440000",
      eventId: "550e8400-e29b-41d4-a716-446655440001",
      quantity: 1
    };
    await request(created.app).post("/bookings").send(payload).expect(201);
    await request(created.app).post("/bookings").send(payload).expect(201);

    expect(
      (await request(created.app).get(`/bookings/users/${payload.userId}/bookings?page=1&pageSize=1`).expect(200)).body
    ).toHaveLength(1);
    expect(
      (await request(created.app).get(`/bookings/users/${payload.userId}/bookings?page=2&pageSize=1`).expect(200)).body
    ).toHaveLength(1);
    await request(created.app).get(`/bookings/users/${payload.userId}/bookings?pageSize=101`).expect(400);
  });

  it("reports Kafka readiness separately from liveness", async () => {
    const db = new FakeBookingDatabase();
    const app = await createBookingApp({ db, kafkaReady: () => false });
    const readiness = await request(app).get("/health/ready").expect(503);
    expect(readiness.body).toEqual({
      status: "not_ready",
      checks: { database: "ok", outbox: "ok", kafka: "failed" }
    });
    await request(app).get("/health/live").expect(200);
  });
});
