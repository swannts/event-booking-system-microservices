import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { execFileSync, spawnSync } from "child_process";
import { createEventDatabase } from "../../src/config/database";
import { PrismaEventRepository } from "../../src/modules/events/event.repository";
import { PrismaInventoryRepository } from "../../src/modules/inventory/inventory.repository";
import { InventoryService } from "../../src/modules/inventory/inventory.service";

const POSTGRES_IMAGE = "postgres:16-alpine";
const POSTGRES_PASSWORD = "postgres";
const POSTGRES_DB = "event_booking";

type TestContext = {
  containerName: string;
  databaseUrl: string;
  db: Awaited<ReturnType<typeof createEventDatabase>>;
  repository: PrismaEventRepository;
  inventoryRepository: PrismaInventoryRepository;
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

describe("release seats safety", () => {
  const context: Partial<TestContext> = {};

  beforeAll(async () => {
    context.containerName = `event-booking-event-service-release-${randomUUID().slice(0, 8)}`;
    execFileSync("docker", [
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

  it("releases seats safely and invalidates cache once on success", async () => {
    const eventId = randomUUID();
    await context.repository!.create({
      id: eventId,
      title: "Release Test Event",
      date: "2026-09-20T10:00:00.000Z",
      totalSeats: 5,
      availableSeats: 4
    });

    const cache = { del: vi.fn(), get: vi.fn(), set: vi.fn() };
    const service = new InventoryService({
      repository: context.inventoryRepository!,
      cache: cache as never,
      publisher: { publish: vi.fn() } as never
    });

    const result = await service.releaseSeats({
      messageId: randomUUID(),
      correlationId: randomUUID(),
      timestamp: new Date().toISOString(),
      version: 1,
      payload: {
        bookingId: randomUUID(),
        eventId,
        quantity: 1
      }
    });

    const finalEvent = await context.repository!.findById(eventId);
    expect(result.released).toBe(true);
    expect(finalEvent?.availableSeats).toBe(5);
    expect(cache.del).toHaveBeenCalledTimes(1);
    expect(cache.del).toHaveBeenCalledWith(eventId);
  }, 60000);

  it("does not release seats twice for the same release message", async () => {
    const eventId = randomUUID();
    const messageId = randomUUID();
    await context.repository!.create({
      id: eventId,
      title: "Duplicate Release Test Event",
      date: "2026-09-20T10:00:00.000Z",
      totalSeats: 5,
      availableSeats: 3
    });

    const first = await context.inventoryRepository!.processReleaseSeatsMessage({
      messageId,
      eventId,
      quantity: 2
    });
    const second = await context.inventoryRepository!.processReleaseSeatsMessage({
      messageId,
      eventId,
      quantity: 2
    });
    const finalEvent = await context.repository!.findById(eventId);

    expect(first.released).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(finalEvent?.availableSeats).toBe(5);
  }, 60000);

  it("rejects invalid quantities and unknown events safely", async () => {
    const eventId = randomUUID();
    await context.repository!.create({
      id: eventId,
      title: "Capacity Guard Test Event",
      date: "2026-09-20T10:00:00.000Z",
      totalSeats: 5,
      availableSeats: 4
    });

    const zeroQuantity = await context.inventoryRepository!.processReleaseSeatsMessage({
      messageId: randomUUID(),
      eventId,
      quantity: 0
    });
    const negativeQuantity = await context.inventoryRepository!.processReleaseSeatsMessage({
      messageId: randomUUID(),
      eventId,
      quantity: -1
    });
    const capacityExceeded = await context.inventoryRepository!.processReleaseSeatsMessage({
      messageId: randomUUID(),
      eventId,
      quantity: 2
    });
    const unknownEvent = await context.inventoryRepository!.processReleaseSeatsMessage({
      messageId: randomUUID(),
      eventId: randomUUID(),
      quantity: 1
    });
    const finalEvent = await context.repository!.findById(eventId);

    expect(zeroQuantity).toMatchObject({ released: false, reason: "INVALID_QUANTITY" });
    expect(negativeQuantity).toMatchObject({ released: false, reason: "INVALID_QUANTITY" });
    expect(capacityExceeded).toMatchObject({ released: false, reason: "CAPACITY_EXCEEDED" });
    expect(unknownEvent).toMatchObject({ released: false, reason: "EVENT_NOT_FOUND" });
    expect(finalEvent?.availableSeats).toBe(4);
  }, 60000);
});
