import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "child_process";
import { randomUUID } from "crypto";
import { Topics } from "@event-booking/contracts";
import { createBookingDatabase } from "../../src/config/database";
import { BookingOutboxDispatcher } from "../../src/modules/bookings/booking-outbox.dispatcher";
import { PrismaBookingRepository } from "../../src/modules/bookings/booking.repository";
import { createBookingRequestFingerprint } from "../../src/modules/idempotency/request-fingerprint";

const POSTGRES_DB = "event_booking";

describe("booking outbox dispatcher concurrency", () => {
  const context: {
    containerName?: string;
    databaseUrl?: string;
    db?: ReturnType<typeof createBookingDatabase>;
    repository?: PrismaBookingRepository;
  } = {};

  beforeAll(async () => {
    context.containerName = `booking-outbox-test-${randomUUID().slice(0, 8)}`;
    execFileSync("docker", [
      "run",
      "-d",
      "--rm",
      "--name",
      context.containerName,
      "-e",
      "POSTGRES_PASSWORD=postgres",
      "-e",
      `POSTGRES_DB=${POSTGRES_DB}`,
      "-p",
      "127.0.0.1::5432",
      "postgres:16-alpine"
    ]);

    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (
        spawnSync("docker", ["exec", context.containerName, "pg_isready", "-U", "postgres", "-d", POSTGRES_DB], {
          stdio: "ignore"
        }).status === 0
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const port = execFileSync("docker", ["port", context.containerName, "5432/tcp"], { encoding: "utf8" })
      .trim()
      .split(":")
      .pop();
    context.databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/${POSTGRES_DB}`;
    execFileSync("corepack", ["pnpm", "prisma:migrate:deploy"], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: context.databaseUrl }
    });
    context.db = createBookingDatabase(context.databaseUrl);
    await context.db.$connect();
    context.repository = new PrismaBookingRepository(context.db);
  }, 60_000);

  afterAll(async () => {
    await context.db?.$disconnect();
    if (context.containerName) {
      spawnSync("docker", ["stop", context.containerName], { stdio: "ignore" });
    }
  });

  it("publishes a row once when two workers claim concurrently", async () => {
    const repository = context.repository!;
    const bookingId = randomUUID();
    const userId = randomUUID();
    const eventId = randomUUID();
    const messageId = randomUUID();
    await repository.createBookingWithOutbox(
      {
        id: bookingId,
        userId,
        eventId,
        quantity: 1,
        status: "PENDING",
        idempotencyKey: null
      },
      {
        id: randomUUID(),
        topic: Topics.RESERVE_SEATS,
        message: {
          messageId,
          correlationId: bookingId,
          timestamp: new Date().toISOString(),
          version: 1,
          payload: { bookingId, userId, eventId, quantity: 1 }
        }
      }
    );

    const published: string[] = [];
    const publisher = {
      publish: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        published.push(messageId);
      }
    };
    const firstWorker = new BookingOutboxDispatcher(repository, publisher);
    const secondWorker = new BookingOutboxDispatcher(repository, publisher);

    await Promise.all([firstWorker.dispatchPending(), secondWorker.dispatchPending()]);

    const outbox = await context.db!.bookingOutboxEvent.findUnique({ where: { messageId } });
    expect(published).toEqual([messageId]);
    expect(outbox).toMatchObject({ status: "PUBLISHED", attempts: 1, claimedAt: null, claimedBy: null });
    expect(outbox?.publishedAt).not.toBeNull();
  });

  it("deduplicates concurrent identical requests and rejects a changed payload", async () => {
    const repository = context.repository!;
    const key = `concurrent-${randomUUID()}`;
    const userId = randomUUID();
    const eventId = randomUUID();
    const request = { userId, eventId, quantity: 2 };
    const fingerprint = createBookingRequestFingerprint(request);

    const create = () => {
      const bookingId = randomUUID();
      return repository.createBookingWithOutbox(
        {
          id: bookingId,
          ...request,
          status: "PENDING",
          idempotencyKey: key,
          requestFingerprint: fingerprint
        },
        {
          id: randomUUID(),
          topic: Topics.RESERVE_SEATS,
          message: {
            messageId: randomUUID(),
            correlationId: bookingId,
            timestamp: new Date().toISOString(),
            version: 1,
            payload: { bookingId, ...request }
          }
        }
      );
    };

    const [first, second] = await Promise.all([create(), create()]);
    expect(second.id).toBe(first.id);
    expect(await context.db!.booking.count({ where: { idempotencyKey: key } })).toBe(1);
    expect(
      await context.db!.bookingOutboxEvent.count({
        where: { message: { path: ["payload", "bookingId"], equals: first.id } }
      })
    ).toBe(1);

    const changed = { userId, eventId, quantity: 3 };
    await expect(
      repository.createBookingWithOutbox(
        {
          id: randomUUID(),
          ...changed,
          status: "PENDING",
          idempotencyKey: key,
          requestFingerprint: createBookingRequestFingerprint(changed)
        },
        {
          id: randomUUID(),
          topic: Topics.RESERVE_SEATS,
          message: {
            messageId: randomUUID(),
            correlationId: randomUUID(),
            timestamp: new Date().toISOString(),
            version: 1,
            payload: { bookingId: randomUUID(), ...changed }
          }
        }
      )
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", statusCode: 409 });

    await context.db!.bookingOutboxEvent.updateMany({
      where: { message: { path: ["payload", "bookingId"], equals: first.id } },
      data: { status: "PUBLISHED", publishedAt: new Date() }
    });
  });

  it("rejects non-positive booking quantities at the database boundary", async () => {
    await expect(
      context.db!.$executeRawUnsafe(
        `INSERT INTO bookings (id, user_id, event_id, quantity, status) VALUES ($1::uuid, $2::uuid, $3::uuid, 0, 'PENDING')`,
        randomUUID(),
        randomUUID(),
        randomUUID()
      )
    ).rejects.toThrow();
  });

  it("reclaims expired work and retains exhausted rows as failed", async () => {
    const repository = context.repository!;
    const bookingId = randomUUID();
    const userId = randomUUID();
    const eventId = randomUUID();
    const messageId = randomUUID();
    await repository.createBookingWithOutbox(
      { id: bookingId, userId, eventId, quantity: 1, status: "PENDING", idempotencyKey: null },
      {
        id: randomUUID(),
        topic: Topics.RESERVE_SEATS,
        message: {
          messageId,
          correlationId: bookingId,
          timestamp: new Date().toISOString(),
          version: 1,
          payload: { bookingId, userId, eventId, quantity: 1 }
        }
      }
    );

    const firstClaim = await repository.claimOutboxMessages({
      workerId: "crashed-worker",
      limit: 1,
      claimTimeoutSeconds: 60,
      maxAttempts: 2
    });
    expect(firstClaim).toHaveLength(1);

    await context.db!.bookingOutboxEvent.update({
      where: { messageId },
      data: { claimedAt: new Date(Date.now() - 120_000) }
    });
    const secondClaim = await repository.claimOutboxMessages({
      workerId: "recovery-worker",
      limit: 1,
      claimTimeoutSeconds: 60,
      maxAttempts: 2
    });
    expect(secondClaim).toHaveLength(1);
    expect(secondClaim[0]).toMatchObject({ attempts: 2, claimedBy: "recovery-worker" });

    await repository.recordOutboxFailure(secondClaim[0]!.id, "recovery-worker", "permanent failure", 2, 30);

    const failed = await context.db!.bookingOutboxEvent.findUnique({ where: { messageId } });
    expect(failed).toMatchObject({ status: "FAILED", attempts: 2, lastError: "permanent failure" });
    expect(failed?.claimedAt).toBeNull();
    expect(failed?.claimedBy).toBeNull();
    expect(failed!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });
});
