import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { newDb } from "pg-mem";
import type { EventCache } from "../src/infrastructure/cache/event-cache";
import { createEventApp } from "../src/app";

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
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const cache = new FakeCache();
  const app = await createEventApp({ db: pool, cache, cacheTtlSeconds: 120 });
  return { app, cache, db: pool };
}

describe("Event Service", () => {
  let app: Awaited<ReturnType<typeof createEventApp>>;
  let cache: FakeCache;
  let db: { query: (sql: string, params?: readonly unknown[]) => Promise<unknown>; end: () => Promise<void> };

  beforeEach(async () => {
    const created = await createTestApp();
    app = created.app;
    cache = created.cache;
    db = created.db;
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
