import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { execFileSync, spawnSync } from "child_process";
import { createClient } from "redis";
import request from "supertest";
import { createEventApp } from "../../src/app";
import { createEventDatabase } from "../../src/config/database";
import { createEventRedisClient } from "../../src/config/redis";
import { RedisEventCache } from "../../src/infrastructure/cache/redis.client";
import { PrismaEventRepository } from "../../src/modules/events/event.repository";
import { EventsService } from "../../src/modules/events/event.service";
import { PrismaInventoryRepository } from "../../src/modules/inventory/inventory.repository";
import { InventoryService } from "../../src/modules/inventory/inventory.service";

const POSTGRES_IMAGE = "postgres:16-alpine";
const REDIS_IMAGE = "redis:7-alpine";
const POSTGRES_PASSWORD = "postgres";
const POSTGRES_DB = "event_booking";

type TestContext = {
  postgresContainer: string;
  redisContainer: string;
  databaseUrl: string;
  redisUrl: string;
  db: Awaited<ReturnType<typeof createEventDatabase>>;
  redis: ReturnType<typeof createEventRedisClient>;
  repository: PrismaEventRepository;
  inventoryRepository: PrismaInventoryRepository;
  app: Awaited<ReturnType<typeof createEventApp>>;
};

async function waitForPostgres(containerName: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync("docker", ["exec", containerName, "pg_isready", "-U", "postgres", "-d", POSTGRES_DB], {
      stdio: "ignore"
    });
    if (result.status === 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error("Postgres container did not become ready in time");
}

async function waitForRedis(url: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const client = createClient({ url });
    try {
      await client.connect();
      await client.ping();
      await client.quit();
      return;
    } catch {
      await client.quit().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error("Redis container did not become ready in time");
}

async function waitForDatabase(databaseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const db = createEventDatabase(databaseUrl);
    try {
      await db.$connect();
      await db.$disconnect();
      return;
    } catch {
      await db.$disconnect().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error("Prisma could not connect to the Postgres test database in time");
}

async function applyMigrations(databaseUrl: string): Promise<void> {
  execFileSync(
    "corepack",
    ["pnpm", "prisma:migrate:deploy"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl
      }
    }
  );
}

describe("redis cache integration", () => {
  const context: Partial<TestContext> = {};

  beforeAll(async () => {
    context.postgresContainer = `event-booking-event-service-redis-postgres-${randomUUID().slice(0, 8)}`;
    context.redisContainer = `event-booking-event-service-redis-${randomUUID().slice(0, 8)}`;

    execFileSync("docker", [
      "run",
      "-d",
      "--rm",
      "--name",
      context.postgresContainer,
      "-e",
      `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
      "-e",
      `POSTGRES_DB=${POSTGRES_DB}`,
      "-p",
      "127.0.0.1::5432",
      POSTGRES_IMAGE
    ]);

    execFileSync("docker", [
      "run",
      "-d",
      "--rm",
      "--name",
      context.redisContainer,
      "-p",
      "127.0.0.1::6379",
      REDIS_IMAGE
    ]);

    const postgresPortInspect = execFileSync("docker", ["port", context.postgresContainer, "5432/tcp"], {
      encoding: "utf8"
    }).trim();
    const postgresHostPort = postgresPortInspect.split(":").pop();
    if (!postgresHostPort) {
      throw new Error("Unable to determine Postgres host port");
    }

    const redisPortInspect = execFileSync("docker", ["port", context.redisContainer, "6379/tcp"], {
      encoding: "utf8"
    }).trim();
    const redisHostPort = redisPortInspect.split(":").pop();
    if (!redisHostPort) {
      throw new Error("Unable to determine Redis host port");
    }

    context.databaseUrl = `postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${postgresHostPort}/${POSTGRES_DB}`;
    context.redisUrl = `redis://127.0.0.1:${redisHostPort}`;

    await waitForPostgres(context.postgresContainer);
    await waitForRedis(context.redisUrl);
    await waitForDatabase(context.databaseUrl);
    await applyMigrations(context.databaseUrl);

    context.db = createEventDatabase(context.databaseUrl);
    await context.db.$connect();
    context.redis = createEventRedisClient(context.redisUrl);
    await context.redis.connect();

    const cache = new RedisEventCache(context.redis);
    context.repository = new PrismaEventRepository(context.db);
    context.inventoryRepository = new PrismaInventoryRepository(context.db);
    const service = new EventsService(context.repository, cache, 120);
    context.app = await createEventApp({
      db: context.db,
      cache,
      cacheTtlSeconds: 120,
      repository: context.repository,
      service
    });
  }, 90000);

  afterAll(async () => {
    if (context.redis) {
      await context.redis.quit().catch(() => undefined);
    }

    if (context.db) {
      await context.db.$disconnect();
    }

    if (context.redisContainer) {
      spawnSync("docker", ["stop", context.redisContainer], { stdio: "ignore" });
    }

    if (context.postgresContainer) {
      spawnSync("docker", ["stop", context.postgresContainer], { stdio: "ignore" });
    }
  }, 90000);

  it("caches event reads and invalidates the cache on write operations", async () => {
    const eventId = randomUUID();

    await context.db!.event.create({
      data: {
        id: eventId,
        title: "Redis Test Event",
        date: new Date("2026-09-20T10:00:00.000Z"),
        totalSeats: 10,
        availableSeats: 10
      }
    });

    const cacheKey = `event:${eventId}`;

    const first = await request(context.app!).get(`/events/${eventId}`).expect(200);
    expect(first.body.id).toBe(eventId);
    expect(first.body.availableSeats).toBe(10);

    const cachedAfterFirst = await context.redis!.get(cacheKey);
    expect(cachedAfterFirst).not.toBeNull();
    expect(JSON.parse(cachedAfterFirst!)).toMatchObject({
      id: eventId,
      title: "Redis Test Event",
      totalSeats: 10,
      availableSeats: 10
    });

    const second = await request(context.app!).get(`/events/${eventId}`).expect(200);
    expect(second.body).toEqual(first.body);

    await request(context.app!)
      .put(`/events/${eventId}`)
      .send({ title: "Redis Test Event Updated", date: "2026-09-21T10:00:00.000Z", totalSeats: 10 })
      .expect(200);

    expect(await context.redis!.get(cacheKey)).toBeNull();

    const afterUpdate = await request(context.app!).get(`/events/${eventId}`).expect(200);
    expect(afterUpdate.body.title).toBe("Redis Test Event Updated");

    const cachedAfterUpdate = await context.redis!.get(cacheKey);
    expect(cachedAfterUpdate).not.toBeNull();
    expect(JSON.parse(cachedAfterUpdate!)).toMatchObject({
      id: eventId,
      title: "Redis Test Event Updated"
    });

    await request(context.app!).delete(`/events/${eventId}`).expect(204);
    expect(await context.redis!.get(cacheKey)).toBeNull();
    await request(context.app!).get(`/events/${eventId}`).expect(404);
  }, 90000);

  it("invalidates cache when seats are reserved through the inventory path", async () => {
    const eventId = randomUUID();

    await context.db!.event.create({
      data: {
        id: eventId,
        title: "Inventory Cache Test",
        date: new Date("2026-09-20T10:00:00.000Z"),
        totalSeats: 5,
        availableSeats: 5
      }
    });

    const cacheKey = `event:${eventId}`;
    await request(context.app!).get(`/events/${eventId}`).expect(200);
    expect(await context.redis!.get(cacheKey)).not.toBeNull();

    const inventory = new InventoryService({
      repository: context.inventoryRepository!,
      cache: new RedisEventCache(context.redis!),
      publisher: {
        publish: async () => undefined
      }
    });

    await inventory.reserveSeats({
      messageId: randomUUID(),
      correlationId: randomUUID(),
      timestamp: new Date().toISOString(),
      version: 1,
      payload: {
        bookingId: randomUUID(),
        eventId,
        userId: randomUUID(),
        quantity: 1
      }
    });

    expect(await context.redis!.get(cacheKey)).toBeNull();

    const refreshed = await request(context.app!).get(`/events/${eventId}`).expect(200);
    expect(refreshed.body.availableSeats).toBe(4);
  }, 90000);

  it("exposes a positive TTL for cache writes", async () => {
    const ttlSeconds = 120;
    expect(ttlSeconds).toBeGreaterThan(0);

    const eventId = randomUUID();
    const cache = new RedisEventCache(context.redis!);
    await cache.set(
      eventId,
      {
        id: eventId,
        title: "TTL Test Event",
        date: "2026-09-20T10:00:00.000Z",
        totalSeats: 1,
        availableSeats: 1,
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z"
      },
      ttlSeconds
    );

    const ttl = await context.redis!.ttl(`event:${eventId}`);
    expect(ttl).toBeGreaterThan(0);
  }, 90000);
});
