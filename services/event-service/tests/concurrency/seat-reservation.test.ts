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
