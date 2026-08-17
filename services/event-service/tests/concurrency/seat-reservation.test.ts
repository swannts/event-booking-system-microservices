import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { execFileSync, spawnSync } from "child_process";
import { createEventDatabase } from "../../src/config/database";
import { PrismaEventRepository } from "../../src/modules/events/event.repository";
import { PrismaInventoryRepository } from "../../src/modules/inventory/inventory.repository";
import { EventOutboxDispatcher } from "../../src/modules/events/event-outbox.dispatcher";
import { Topics } from "@event-booking/contracts";

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

async function applyMigrations(databaseUrl: string): Promise<void> {
  execFileSync("corepack", ["pnpm", "prisma:migrate:deploy"], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl
    }
  });
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
    await applyMigrations(context.databaseUrl);

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

  it.each([
    [0, 0],
    [10, -1],
    [10, 11]
  ])("rejects invalid direct capacity writes (total=%d, available=%d)", async (totalSeats, availableSeats) => {
    await expect(
      context.db!.$executeRawUnsafe(
        `INSERT INTO events (id, title, date, total_seats, available_seats) VALUES ($1::uuid, 'Invalid', NOW(), $2, $3)`,
        randomUUID(),
        totalSeats,
        availableSeats
      )
    ).rejects.toThrow();
  });

  it("allows only the available seats to be reserved under concurrent load", async () => {
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
  }, 60000);

  it("preserves reserved seats when capacity update races with a reservation", async () => {
    const repository = context.repository;
    const inventoryRepository = context.inventoryRepository;

    for (let iteration = 0; iteration < 20; iteration += 1) {
      const eventId = randomUUID();
      await repository.create({
        id: eventId,
        title: "Capacity Update Concurrency Test",
        date: "2026-09-20T10:00:00.000Z",
        totalSeats: 10
      });

      const [updatedEvent, reservedEvent] = await Promise.all([
        repository.update(eventId, {
          title: "Updated Capacity Concurrency Test",
          date: "2026-09-21T10:00:00.000Z",
          totalSeats: 12
        }),
        inventoryRepository.reserveSeats(eventId, 2)
      ]);

      const finalEvent = await repository.findById(eventId);

      expect(updatedEvent).not.toBeNull();
      expect(reservedEvent).not.toBeNull();
      expect(finalEvent).not.toBeNull();
      expect(finalEvent!.availableSeats).toBeLessThanOrEqual(finalEvent!.totalSeats);
      expect(finalEvent!.availableSeats).toBeGreaterThanOrEqual(0);
      expect(finalEvent!.totalSeats - finalEvent!.availableSeats).toBe(2);
      expect(finalEvent).toMatchObject({ totalSeats: 12, availableSeats: 10 });
    }
  }, 60000);

  it("allows only one database-backed outbox worker to publish a claimed row", async () => {
    const repository = context.repository;
    const inventoryRepository = context.inventoryRepository;
    const db = context.db;
    const eventId = randomUUID();
    const bookingId = randomUUID();
    const messageId = randomUUID();

    await repository.create({
      id: eventId,
      title: "Outbox Worker Concurrency Test",
      date: "2026-09-20T10:00:00.000Z",
      totalSeats: 2
    });
    const reservation = await inventoryRepository.processReserveSeatsMessage({
      messageId: randomUUID(),
      eventId,
      quantity: 1,
      outboxOnSuccess: {
        id: randomUUID(),
        topic: Topics.SEATS_RESERVED,
        messageId,
        message: {
          messageId,
          correlationId: bookingId,
          timestamp: new Date().toISOString(),
          version: 1,
          payload: { bookingId, eventId, quantity: 1 }
        }
      }
    });
    expect(reservation.reserved).toBe(true);

    const published: string[] = [];
    const publisher = {
      publish: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        published.push(messageId);
      }
    };
    const firstWorker = new EventOutboxDispatcher(inventoryRepository, publisher);
    const secondWorker = new EventOutboxDispatcher(inventoryRepository, publisher);

    await Promise.all([firstWorker.dispatchPending(), secondWorker.dispatchPending()]);

    const outbox = await db.eventOutboxEvent.findUnique({ where: { messageId } });
    expect(published).toEqual([messageId]);
    expect(outbox).toMatchObject({ status: "PUBLISHED", attempts: 1, claimedAt: null, claimedBy: null });
    expect(outbox?.publishedAt).not.toBeNull();
  }, 60000);
});
