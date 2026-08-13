import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import type { EventCache } from "../../src/infrastructure/cache/event.cache";
import { createEventApp } from "../../src/app";
import type { EventDatabaseClient } from "../../src/modules/events/event.repository";

type EventRow = {
  id: string;
  title: string;
  date: Date;
  totalSeats: number;
  availableSeats: number;
  createdAt: Date;
  updatedAt: Date;
};

type ProcessedMessageRow = {
  messageId: string;
  processedAt: Date;
};

class FakeEventDatabase implements EventDatabaseClient {
  public readonly events = new Map<string, EventRow>();
  public readonly processedMessages = new Map<string, ProcessedMessageRow>();

  public readonly event = {
    create: async ({
      data
    }: {
      data: {
        id: string;
        title: string;
        date: Date;
        totalSeats: number;
        availableSeats: number;
      };
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
    findUnique: async ({ where }: { where: { id: string } }) => {
      return this.events.get(where.id) ?? null;
    },
    findMany: async (input?: { orderBy?: { createdAt?: "asc" | "desc" } }) => {
      const rows = [...this.events.values()].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
      return input?.orderBy?.createdAt === "desc" ? rows.reverse() : rows;
    },
    update: async ({
      where,
      data
    }: {
      where: { id: string };
      data: { title?: string; date?: Date; totalSeats?: number; availableSeats?: number };
    }) => {
      const current = this.events.get(where.id);
      if (!current) {
        throw new Error("Record not found");
      }

      const updated: EventRow = {
        ...current,
        ...data,
        updatedAt: new Date("2026-08-13T00:00:00.000Z")
      };
      this.events.set(where.id, updated);
      return updated;
    },
    deleteMany: async ({ where }: { where: { id: string } }) => {
      const deleted = this.events.delete(where.id);
      return { count: deleted ? 1 : 0 };
    },
    updateMany: async ({
      where,
      data
    }: {
      where: { id: string; availableSeats?: { gte: number } };
      data: { availableSeats?: { decrement?: number; increment?: number }; updatedAt?: Date };
    }) => {
      const current = this.events.get(where.id);
      if (!current) {
        return { count: 0 };
      }

      if (where.availableSeats?.gte !== undefined && current.availableSeats < where.availableSeats.gte) {
        return { count: 0 };
      }

      const decrement = data.availableSeats?.decrement ?? 0;
      const increment = data.availableSeats?.increment ?? 0;
      const updated: EventRow = {
        ...current,
        availableSeats: current.availableSeats - decrement + increment,
        updatedAt: data.updatedAt ?? new Date("2026-08-13T00:00:00.000Z")
      };
      this.events.set(where.id, updated);
      return { count: 1 };
    }
  };

  public readonly processedEventMessage = {
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
}

class FakeCache implements EventCache {
  public gets = 0;
  public sets = 0;
  public dels = 0;
  private readonly store = new Map<string, unknown>();

  async get(eventId: string) {
    this.gets += 1;
    return (this.store.get(eventId) as never) ?? null;
  }

  async set(eventId: string, event: unknown) {
    this.sets += 1;
    this.store.set(eventId, event);
  }

  async del(eventId: string) {
    this.dels += 1;
    this.store.delete(eventId);
  }
}

async function createTestApp() {
  const db = new FakeEventDatabase();
  const cache = new FakeCache();
  const app = await createEventApp({ db, cache, cacheTtlSeconds: 120 });
  return { app, cache, db };
}

describe("Event Service", () => {
  let app: Awaited<ReturnType<typeof createEventApp>>;
  let cache: FakeCache;

  beforeEach(async () => {
    const created = await createTestApp();
    app = created.app;
    cache = created.cache;
  });

  it("creates an event", async () => {
    const res = await request(app)
      .post("/events")
      .send({ title: "Node.js Conference", date: "2026-09-20T10:00:00Z", totalSeats: 100 })
      .expect(201);

    expect(res.body.title).toBe("Node.js Conference");
    expect(res.body.availableSeats).toBe(100);
  });

  it("caches event reads and reuses cache", async () => {
    const created = await request(app)
      .post("/events")
      .send({ title: "Node.js Conference", date: "2026-09-20T10:00:00Z", totalSeats: 100 })
      .expect(201);

    const eventId = created.body.id;

    const first = await request(app).get(`/events/${eventId}`).expect(200);
    const second = await request(app).get(`/events/${eventId}`).expect(200);

    expect(first.body.id).toBe(eventId);
    expect(second.body.id).toBe(eventId);
    expect(cache.sets).toBe(1);
    expect(cache.gets).toBe(2);
  });

  it("clears cache on update", async () => {
    const created = await request(app)
      .post("/events")
      .send({ title: "Node.js Conference", date: "2026-09-20T10:00:00Z", totalSeats: 100 })
      .expect(201);

    const eventId = created.body.id;
    await request(app).get(`/events/${eventId}`).expect(200);

    await request(app)
      .put(`/events/${eventId}`)
      .send({ title: "Node.js Summit", date: "2026-09-21T10:00:00Z", totalSeats: 90 })
      .expect(200);

    expect(cache.dels).toBe(1);
  });

  it("clears cache on delete", async () => {
    const created = await request(app)
      .post("/events")
      .send({ title: "Node.js Conference", date: "2026-09-20T10:00:00Z", totalSeats: 100 })
      .expect(201);

    const eventId = created.body.id;
    await request(app).get(`/events/${eventId}`).expect(200);

    await request(app).delete(`/events/${eventId}`).expect(204);

    expect(cache.dels).toBe(1);
    await request(app).get(`/events/${eventId}`).expect(404);
  });
});
