import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { execFileSync, spawnSync } from "child_process";
import { createEventDatabase } from "../../src/config/database";
import { PrismaEventRepository } from "../../src/modules/events/event.repository";
import { PrismaInventoryRepository } from "../../src/modules/inventory/inventory.repository";

const POSTGRES_IMAGE = "postgres:16-alpine";
const POSTGRES_PASSWORD = "postgres";
const POSTGRES_DB = "event_booking";

type TestContext = {
  containerName: string;
  databaseUrl: string;
  repository: PrismaEventRepository;
  inventoryRepository: PrismaInventoryRepository;
  db: Awaited<ReturnType<typeof createEventDatabase>>;
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

async function createSchema(databaseUrl: string): Promise<void> {
  const db = createEventDatabase(databaseUrl);
  await db.$connect();
  try {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS events (
        id UUID PRIMARY KEY,
        title TEXT NOT NULL,
        date TIMESTAMP(3) NOT NULL,
        total_seats INTEGER NOT NULL,
        available_seats INTEGER NOT NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP(3) NOT NULL DEFAULT NOW()
      );
    `);
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS processed_event_messages (
        message_id TEXT PRIMARY KEY,
        processed_at TIMESTAMP(3) NOT NULL DEFAULT NOW()
      );
    `);
    await db.$executeRawUnsafe(`
      DO $$ BEGIN
        CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS event_outbox_events (
        id UUID PRIMARY KEY,
        topic TEXT NOT NULL,
        message_id TEXT NOT NULL UNIQUE,
        message JSONB NOT NULL,
        status "OutboxStatus" NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TIMESTAMP(3) NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP(3) NOT NULL DEFAULT NOW(),
        published_at TIMESTAMP(3)
      );
    `);
    await db.$executeRawUnsafe(`DELETE FROM event_outbox_events;`);
    await db.$executeRawUnsafe(`DELETE FROM processed_event_messages;`);
    await db.$executeRawUnsafe(`DELETE FROM events;`);
  } finally {
    await db.$disconnect();
  }
}

describe("seat reservation concurrency", () => {
  const context: Partial<TestContext> = {};

  beforeAll(async () => {
    context.containerName = `event-booking-event-service-test-${randomUUID().slice(0, 8)}`;
    const runResult = execFileSync("docker", [
      "run",
      "-d",
      "--rm",
      "--name",
      context.containerName,
      "-e",
      `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
      "-e",
      `POSTGRES_DB=${POSTGRES_DB}`,
      "-p",
      "127.0.0.1::5432",
      POSTGRES_IMAGE
    ]);

    if (!runResult.toString().trim()) {
      throw new Error("Failed to start Postgres test container");
    }

    const portInspect = execFileSync("docker", ["port", context.containerName, "5432/tcp"], {
      encoding: "utf8"
    }).trim();
    const hostPort = portInspect.split(":").pop();
    if (!hostPort) {
      throw new Error("Unable to determine Postgres host port");
    }

    context.databaseUrl = `postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${hostPort}/${POSTGRES_DB}`;
    await waitForPostgres(context.containerName);
    await waitForDatabase(context.databaseUrl);
    await createSchema(context.databaseUrl);

    context.db = createEventDatabase(context.databaseUrl);
    await context.db.$connect();
    context.repository = new PrismaEventRepository(context.db);
    context.inventoryRepository = new PrismaInventoryRepository(context.db);
  }, 60000);

  afterAll(async () => {
    if (context.db) {
      await context.db.$disconnect();
    }

    if (context.containerName) {
      spawnSync("docker", ["stop", context.containerName], { stdio: "ignore" });
    }
  }, 60000);

  it(
    "allows only the available seats to be reserved under concurrent load",
    async () => {
      const repository = context.repository;
      const inventoryRepository = context.inventoryRepository;
      const eventId = randomUUID();

      await repository.create({
        id: eventId,
        title: "Concurrency Test Event",
        date: "2026-09-20T10:00:00.000Z",
        totalSeats: 5
      });

      let observedMinimum = Number.POSITIVE_INFINITY;
      let polling = true;
      const poller = (async () => {
        while (polling) {
          const current = await repository.findById(eventId);
          if (current) {
            observedMinimum = Math.min(observedMinimum, current.availableSeats);
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      })();

      const attempts = Array.from({ length: 20 }, () => inventoryRepository.reserveSeats(eventId, 1));
      const settled = await Promise.allSettled(attempts);
      polling = false;
      await poller;

      const fulfilled = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
      const successfulReservations = fulfilled.filter((value) => value !== null);
      const failedReservations = fulfilled.filter((value) => value === null);

      const finalEvent = await repository.findById(eventId);

      expect(successfulReservations).toHaveLength(5);
      expect(failedReservations).toHaveLength(15);
      expect(finalEvent?.availableSeats).toBe(0);
      expect(observedMinimum).toBeGreaterThanOrEqual(0);
    },
    60000
  );
});
