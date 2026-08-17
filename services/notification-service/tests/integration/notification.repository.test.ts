import { execFileSync, spawnSync } from "child_process";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNotificationDatabase } from "../../src/config/database";
import { PrismaNotificationRepository } from "../../src/infrastructure/notifications/notification.repository";
import type { NotificationRecord } from "../../src/modules/notifications/notification.types";

describe("PrismaNotificationRepository", () => {
  const context: {
    containerName?: string;
    databaseUrl?: string;
    db?: ReturnType<typeof createNotificationDatabase>;
  } = {};

  beforeAll(async () => {
    context.containerName = `notification-db-test-${randomUUID().slice(0, 8)}`;
    execFileSync("docker", [
      "run",
      "-d",
      "--rm",
      "--name",
      context.containerName,
      "-e",
      "POSTGRES_PASSWORD=postgres",
      "-e",
      "POSTGRES_DB=event_booking",
      "-p",
      "127.0.0.1::5432",
      "postgres:16-alpine"
    ]);

    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (
        spawnSync("docker", ["exec", context.containerName, "pg_isready", "-U", "postgres", "-d", "event_booking"])
          .status === 0
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const port = execFileSync("docker", ["port", context.containerName, "5432/tcp"], { encoding: "utf8" })
      .trim()
      .split(":")
      .pop();
    context.databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/event_booking`;
    execFileSync("corepack", ["pnpm", "prisma:migrate:deploy"], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: context.databaseUrl }
    });
    context.db = createNotificationDatabase(context.databaseUrl);
    await context.db.$connect();
  }, 60_000);

  afterAll(async () => {
    await context.db?.$disconnect();
    if (context.containerName) spawnSync("docker", ["stop", context.containerName], { stdio: "ignore" });
  });

  it("atomically stores one notification and one processed marker under duplicate delivery", async () => {
    const repository = new PrismaNotificationRepository(context.db!);
    const record: NotificationRecord = {
      timestamp: new Date().toISOString(),
      service: "notification-service",
      level: "info",
      message: "Booking confirmed",
      type: "BOOKING_CONFIRMED",
      messageId: randomUUID(),
      correlationId: randomUUID(),
      bookingId: randomUUID(),
      eventId: randomUUID()
    };

    const results = await Promise.all(Array.from({ length: 8 }, () => repository.appendIfUnprocessed(record)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await context.db!.notification.count({ where: { messageId: record.messageId } })).toBe(1);
    expect(await context.db!.processedNotificationMessage.count({ where: { messageId: record.messageId } })).toBe(1);
  });

  it("retains notifications across repository and database client restarts", async () => {
    const messageId = randomUUID();
    const first = new PrismaNotificationRepository(context.db!);
    await first.appendIfUnprocessed({
      timestamp: new Date().toISOString(),
      service: "notification-service",
      level: "info",
      message: "Booking cancelled",
      type: "BOOKING_CANCELLED",
      messageId,
      correlationId: randomUUID(),
      bookingId: randomUUID(),
      eventId: randomUUID()
    });

    await context.db!.$disconnect();
    const restartedDb = createNotificationDatabase(context.databaseUrl!);
    await restartedDb.$connect();
    context.db = restartedDb;
    const records = await new PrismaNotificationRepository(restartedDb).list();
    expect(records.some((record) => record.messageId === messageId)).toBe(true);
  });
});
