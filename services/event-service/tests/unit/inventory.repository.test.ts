import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { Topics } from "@event-booking/contracts";
import { Prisma } from "../../../generated/prisma";
import { PrismaInventoryRepository, type InventoryDatabaseClient } from "../../src/modules/inventory/inventory.repository";
import type { EventRecord } from "../../src/modules/events/event.repository";

type EventRow = EventRecord;

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

function cloneEvent(row: EventRow): EventRow {
  return {
    ...row,
    date: new Date(row.date),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt)
  };
}

class FakeInventoryDatabase implements InventoryDatabaseClient {
  public events = new Map<string, EventRow>();
  public processedMessages = new Map<string, { messageId: string }>();
  public outboxEvents = new Map<string, OutboxRow>();
  public failOutboxCreate = false;

  public readonly event = {
    findUnique: async ({ where }: { where: { id: string } }) => this.events.get(where.id) ?? null,
    create: async ({
      data
    }: {
      data: { id: string; title: string; date: Date; totalSeats: number; availableSeats: number };
    }) => {
      const row: EventRow = {
        id: data.id,
        title: data.title,
        date: data.date,
        totalSeats: data.totalSeats,
        availableSeats: data.availableSeats,
        createdAt: new Date("2026-08-13T00:00:00.000Z"),
        updatedAt: new Date("2026-08-13T00:00:00.000Z")
      };
      this.events.set(row.id, row);
      return row;
    },
    updateMany: async ({
      where,
      data
    }: {
      where: { id: string; availableSeats?: { gte: number } };
      data: { availableSeats?: { decrement?: number; increment?: number }; updatedAt?: Date };
    }) => {
      const row = this.events.get(where.id);
      if (!row) {
        return { count: 0 };
      }

      const decrement = data.availableSeats?.decrement ?? 0;
      const increment = data.availableSeats?.increment ?? 0;
      const nextAvailableSeats = row.availableSeats - decrement + increment;
      const threshold = where.availableSeats?.gte ?? 0;
      if (row.availableSeats < threshold) {
        return { count: 0 };
      }

      this.events.set(where.id, {
        ...row,
        availableSeats: nextAvailableSeats,
        updatedAt: data.updatedAt ?? new Date("2026-08-13T00:00:00.000Z")
      });
      return { count: 1 };
    }
  };

  public readonly processedEventMessage = {
    create: async ({ data }: { data: { messageId: string } }) => {
      if (this.processedMessages.has(data.messageId)) {
        const error = new Error("Unique constraint failed");
        (error as { code?: string }).code = "P2002";
        throw error;
      }

      const row = { messageId: data.messageId };
      this.processedMessages.set(row.messageId, row);
      return row;
    },
    findUnique: async ({ where }: { where: { messageId: string } }) => this.processedMessages.get(where.messageId) ?? null
  };

  public readonly eventOutboxEvent = {
    create: async ({
      data
    }: {
      data: {
        id: string;
        topic: string;
        messageId: string;
        message: unknown;
        status?: "PENDING" | "PUBLISHED";
      };
    }) => {
      if (this.failOutboxCreate) {
        throw new Error("outbox insert failed");
      }

      const row: OutboxRow = {
        id: data.id,
        topic: data.topic,
        messageId: data.messageId,
        message: data.message,
        status: data.status ?? "PENDING",
        attempts: 0,
        lastError: null,
        createdAt: new Date("2026-08-13T00:00:00.000Z"),
        updatedAt: new Date("2026-08-13T00:00:00.000Z"),
        publishedAt: null
      };
      this.outboxEvents.set(row.id, row);
      return row;
    },
    findMany: async () => [...this.outboxEvents.values()],
    update: async ({
      where,
      data
    }: {
      where: { id: string };
      data: {
        status?: "PENDING" | "PUBLISHED";
        attempts?: { increment: number };
        lastError?: string;
        publishedAt?: Date;
      };
    }) => {
      const row = this.outboxEvents.get(where.id);
      if (!row) {
        throw new Error("Record not found");
      }

      const updated: OutboxRow = {
        ...row,
        status: data.status ?? row.status,
        attempts: data.attempts ? row.attempts + data.attempts.increment : row.attempts,
        lastError: data.lastError ?? row.lastError,
        publishedAt: data.publishedAt ?? row.publishedAt,
        updatedAt: new Date("2026-08-13T00:00:00.000Z")
      };
      this.outboxEvents.set(where.id, updated);
      return updated;
    }
  };

  async $connect() {}
  async $disconnect() {}

  async $queryRaw<T>(query: TemplateStringsArray | ReturnType<typeof Prisma.sql>): Promise<T> {
    const values = Array.isArray((query as { values?: unknown[] }).values) ? ((query as { values: unknown[] }).values as unknown[]) : [];
    const quantity = Number(values[0] ?? 0);
    const eventId = String(values[1] ?? "");
    const row = this.events.get(eventId);

    if (!row || row.availableSeats < quantity) {
      return [] as T;
    }

    const updated: EventRow = {
      ...row,
      availableSeats: row.availableSeats - quantity,
      updatedAt: new Date("2026-08-13T00:00:00.000Z")
    };
    this.events.set(eventId, updated);
    return [updated] as T;
  }

  async $transaction<T>(fn: (tx: InventoryDatabaseClient) => Promise<T>): Promise<T> {
    const snapshot = {
      events: new Map([...this.events.entries()].map(([key, value]) => [key, cloneEvent(value)])),
      processedMessages: new Map(this.processedMessages),
      outboxEvents: new Map(
        [...this.outboxEvents.entries()].map(([key, value]) => [key, { ...value, createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt), publishedAt: value.publishedAt ? new Date(value.publishedAt) : null }])
      ),
      failOutboxCreate: this.failOutboxCreate
    };

    try {
      return await fn(this);
    } catch (error) {
      this.events = snapshot.events;
      this.processedMessages = snapshot.processedMessages;
      this.outboxEvents = snapshot.outboxEvents;
      this.failOutboxCreate = snapshot.failOutboxCreate;
      throw error;
    }
  }
}

describe("PrismaInventoryRepository", () => {
  it("creates an outbox row when a reservation succeeds", async () => {
    const db = new FakeInventoryDatabase();
    const repository = new PrismaInventoryRepository(db);
    const eventId = randomUUID();
    await db.event.create({
      data: {
        id: eventId,
        title: "Conference",
        date: new Date("2026-09-20T10:00:00.000Z"),
        totalSeats: 10,
        availableSeats: 10
      }
    });

    const result = await repository.processReserveSeatsMessage({
      messageId: randomUUID(),
      eventId,
      quantity: 2,
      outboxOnSuccess: {
        id: randomUUID(),
        topic: Topics.SEATS_RESERVED,
        messageId: randomUUID(),
        message: { payload: { bookingId: "booking-1", eventId, quantity: 2 } }
      },
      outboxOnFailure: {
        id: randomUUID(),
        topic: Topics.SEAT_RESERVATION_FAILED,
        messageId: randomUUID(),
        correlationId: randomUUID(),
        bookingId: "booking-1"
      }
    });

    expect(result.reserved).toBe(true);
    expect(db.outboxEvents.size).toBe(1);
    expect(db.events.get(eventId)?.availableSeats).toBe(8);
  });

  it("creates a failure outbox row when seats are insufficient", async () => {
    const db = new FakeInventoryDatabase();
    const repository = new PrismaInventoryRepository(db);
    const eventId = randomUUID();
    await db.event.create({
      data: {
        id: eventId,
        title: "Conference",
        date: new Date("2026-09-20T10:00:00.000Z"),
        totalSeats: 10,
        availableSeats: 1
      }
    });

    const result = await repository.processReserveSeatsMessage({
      messageId: randomUUID(),
      eventId,
      quantity: 2,
      outboxOnSuccess: {
        id: randomUUID(),
        topic: Topics.SEATS_RESERVED,
        messageId: randomUUID(),
        message: { payload: { bookingId: "booking-1", eventId, quantity: 2 } }
      },
      outboxOnFailure: {
        id: randomUUID(),
        topic: Topics.SEAT_RESERVATION_FAILED,
        messageId: randomUUID(),
        correlationId: randomUUID(),
        bookingId: "booking-1"
      }
    });

    expect(result.reserved).toBe(false);
    expect(result.reason).toBe("INSUFFICIENT_SEATS");
    expect(db.outboxEvents.size).toBe(1);
    expect(db.events.get(eventId)?.availableSeats).toBe(1);
  });

  it("rolls back seat changes if outbox insertion fails", async () => {
    const db = new FakeInventoryDatabase();
    const repository = new PrismaInventoryRepository(db);
    const eventId = randomUUID();
    await db.event.create({
      data: {
        id: eventId,
        title: "Conference",
        date: new Date("2026-09-20T10:00:00.000Z"),
        totalSeats: 10,
        availableSeats: 10
      }
    });
    db.failOutboxCreate = true;

    await expect(
      repository.processReserveSeatsMessage({
        messageId: randomUUID(),
        eventId,
        quantity: 2,
        outboxOnSuccess: {
          id: randomUUID(),
          topic: Topics.SEATS_RESERVED,
          messageId: randomUUID(),
          message: { payload: { bookingId: "booking-1", eventId, quantity: 2 } }
        },
        outboxOnFailure: {
          id: randomUUID(),
          topic: Topics.SEAT_RESERVATION_FAILED,
          messageId: randomUUID(),
          correlationId: randomUUID(),
          bookingId: "booking-1"
        }
      })
    ).rejects.toThrow("outbox insert failed");

    expect(db.events.get(eventId)?.availableSeats).toBe(10);
    expect(db.processedMessages.size).toBe(0);
    expect(db.outboxEvents.size).toBe(0);
  });
});
