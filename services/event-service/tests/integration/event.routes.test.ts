import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { EventCache } from "../../src/infrastructure/cache/event-cache";
import { createEventApp } from "../../src/app";
import type { EventDatabaseClient } from "../../src/modules/events/event.repository";
import { CapacityBelowReservedSeatsError } from "../../src/modules/events/event.repository";

type EventRow = {
  id: string;
  title: string;
  date: Date;
  totalSeats: number;
  availableSeats: number;
  createdAt: Date;
  updatedAt: Date;
};

class FakeEventDatabase implements EventDatabaseClient {
  public readonly events = new Map<string, EventRow>();

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
    findMany: async (input?: { skip?: number; take?: number }) => {
      const rows = [...this.events.values()].sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
      );
      return rows.slice(input?.skip ?? 0, (input?.skip ?? 0) + (input?.take ?? 20));
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
    }
  };

  async $queryRaw<T>(query: { values: unknown[] }): Promise<T> {
    if (query.values.length === 1) {
      const [id] = query.values as [string];
      const current = this.events.get(id);
      if (current && current.availableSeats === current.totalSeats) {
        this.events.delete(id);
        return [{ id }] as T;
      }
      return [] as T;
    }

    const [title, date, nextTotalSeats, , id] = query.values as [string, Date, number, number, string, number];
    const current = this.events.get(id);
    if (!current || nextTotalSeats < current.totalSeats - current.availableSeats) {
      return [] as T;
    }

    const updated: EventRow = {
      ...current,
      title,
      date,
      totalSeats: nextTotalSeats,
      availableSeats: nextTotalSeats - (current.totalSeats - current.availableSeats),
      updatedAt: new Date("2026-08-13T00:00:00.000Z")
    };
    this.events.set(id, updated);
    return [updated] as T;
  }

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

async function createTestApp(rateLimitMaxRequests = 100, trustProxy: boolean | number = false) {
  const db = new FakeEventDatabase();
  const cache = new FakeCache();
  const app = await createEventApp({ db, cache, cacheTtlSeconds: 120, rateLimitMaxRequests, trustProxy });
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

  it("rejects capacity below the number of reserved seats", async () => {
    const created = await request(app)
      .post("/events")
      .send({ title: "Node.js Conference", date: "2026-09-20T10:00:00Z", totalSeats: 5 })
      .expect(201);

    // This API-level assertion uses a repository stub because reservations are message-driven.
    const repository = {
      create: async () => created.body,
      findById: async () => created.body,
      list: async () => [created.body],
      update: async () => {
        throw new CapacityBelowReservedSeatsError();
      },
      delete: async () => true
    };
    const conflictApp = await createEventApp({
      db: new FakeEventDatabase(),
      repository,
      cache: new FakeCache()
    });

    const response = await request(conflictApp)
      .put(`/events/${created.body.id}`)
      .send({ title: "Node.js Conference", date: "2026-09-20T10:00:00Z", totalSeats: 1 })
      .expect(409);

    expect(response.body).toMatchObject({
      error: {
        code: "CAPACITY_BELOW_RESERVED_SEATS",
        message: "Event capacity cannot be lower than the number of reserved seats"
      }
    });
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

  it("rejects deleting an event with reservations without invalidating its cache", async () => {
    const created = await createTestApp();
    const event = await request(created.app)
      .post("/events")
      .send({ title: "Reserved Conference", date: "2026-09-20T10:00:00Z", totalSeats: 10 })
      .expect(201);
    const row = created.db.events.get(event.body.id)!;
    row.availableSeats = 8;

    const response = await request(created.app).delete(`/events/${event.body.id}`).expect(409);
    expect(response.body.error.code).toBe("EVENT_HAS_RESERVATIONS");
    expect(created.db.events.has(event.body.id)).toBe(true);
    expect(created.cache.dels).toBe(0);
  });

  it("validates bounded pagination", async () => {
    await request(app)
      .post("/events")
      .send({ title: "First", date: "2026-09-20T10:00:00Z", totalSeats: 10 })
      .expect(201);
    await request(app)
      .post("/events")
      .send({ title: "Second", date: "2026-09-21T10:00:00Z", totalSeats: 10 })
      .expect(201);
    expect((await request(app).get("/events?page=1&pageSize=1").expect(200)).body).toHaveLength(1);
    expect((await request(app).get("/events?page=2&pageSize=1").expect(200)).body).toHaveLength(1);
    await request(app).get("/events?pageSize=101").expect(400);
  });

  it("reports failed critical dependencies without affecting liveness", async () => {
    const created = await createTestApp();
    const notReadyApp = await createEventApp({
      db: created.db,
      cache: created.cache,
      kafkaReady: () => false
    });

    expect((await request(notReadyApp).get("/health/ready").expect(503)).body).toEqual({
      status: "not_ready",
      checks: { database: "ok", redis: "ok", kafka: "failed" }
    });
    await request(notReadyApp).get("/health/live").expect(200);
  });

  it("exposes low-cardinality HTTP and cache metrics", async () => {
    const created = await request(app)
      .post("/events")
      .send({ title: "Metrics", date: "2026-09-20T10:00:00Z", totalSeats: 10 })
      .expect(201);
    await request(app).get(`/events/${created.body.id}`).expect(200);
    const metrics = await request(app).get("/metrics").expect(200);
    expect(metrics.text).toContain("event_booking_http_requests_total");
    expect(metrics.text).toContain('operation="cache_get",outcome="miss"');
  });

  it("returns 429 when the event route exceeds the configured rate limit", async () => {
    const created = await createTestApp(1);

    const event = await request(created.app)
      .post("/events")
      .send({ title: "Rate Limited Conference", date: "2026-09-20T10:00:00Z", totalSeats: 100 })
      .expect(201);

    await request(created.app).get(`/events/${event.body.id}`).expect(200);
    const limited = await request(created.app).get(`/events/${event.body.id}`).expect(429);

    expect(limited.body.error).toBe("Too Many Requests");
    expect((await request(created.app).get("/metrics").expect(200)).text).toContain(
      'operation="rate_limit",outcome="rejected"'
    );
  });

  it("uses the forwarded client IP only when proxy trust is configured", async () => {
    const created = await createTestApp(1, 1);
    const event = await request(created.app)
      .post("/events")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ title: "Proxy Conference", date: "2026-09-20T10:00:00Z", totalSeats: 10 })
      .expect(201);

    await request(created.app).get(`/events/${event.body.id}`).set("X-Forwarded-For", "203.0.113.10").expect(200);
    await request(created.app).get(`/events/${event.body.id}`).set("X-Forwarded-For", "203.0.113.10").expect(429);
    await request(created.app).get(`/events/${event.body.id}`).set("X-Forwarded-For", "203.0.113.11").expect(200);
  });
});
