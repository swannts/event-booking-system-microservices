import { execFileSync, spawnSync } from "child_process";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBookingDatabase } from "../../services/booking-service/src/config/database";
import { PrismaBookingRepository } from "../../services/booking-service/src/modules/bookings/booking.repository";
import { createEventDatabase } from "../../services/event-service/src/config/database";
import { PrismaEventRepository } from "../../services/event-service/src/modules/events/event.repository";

let database: { name: string; url: string };

async function startPostgres(prefix: string) {
  const name = `${prefix}-${randomUUID().slice(0, 8)}`;
  execFileSync("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=postgres",
    "-e",
    "POSTGRES_DB=event_booking",
    "-p",
    "127.0.0.1::5432",
    "postgres:16-alpine"
  ]);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (spawnSync("docker", ["exec", name, "pg_isready", "-U", "postgres", "-d", "event_booking"]).status === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const port = execFileSync("docker", ["port", name, "5432/tcp"], { encoding: "utf8" }).trim().split(":").pop();
  return { name, url: `postgresql://postgres:postgres@127.0.0.1:${port}/event_booking` };
}

function pnpmPrisma(service: string, url: string, args: string[]) {
  execFileSync("corepack", ["pnpm", "--dir", `services/${service}`, "exec", "prisma", ...args], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url }
  });
}

function psql(container: string, sql: string): string {
  return execFileSync("docker", ["exec", container, "psql", "-U", "postgres", "-d", "event_booking", "-Atc", sql], {
    encoding: "utf8"
  }).trim();
}

function applyPreviousMigration(container: string, service: string, migration: string) {
  const sql = readFileSync(`services/${service}/prisma/migrations/${migration}/migration.sql`, "utf8");
  const result = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "event_booking"],
    {
      input: sql,
      encoding: "utf8"
    }
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

beforeAll(async () => {
  database = await startPostgres("migration-safety");
});

beforeEach(() => {
  psql(database.name, "DROP SCHEMA public CASCADE; CREATE SCHEMA public");
});

afterAll(() => {
  spawnSync("docker", ["stop", "--time", "0", database.name], { stdio: "ignore" });
});

describe("Prisma migration safety", () => {
  it.each(["user-service", "event-service", "booking-service", "notification-service"])(
    "deploys the complete %s history into an empty PostgreSQL database",
    async (service) => {
      pnpmPrisma(service, database.url, ["migrate", "deploy"]);
      expect(
        Number(psql(database.name, `SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`))
      ).toBeGreaterThan(0);
    }
  );

  it("upgrades booking data, backfills fingerprints, and boots the latest repository", async () => {
    const previous = ["20260813000000_init", "20260814_add_booking_outbox", "20260817000000_harden_booking_outbox"];
    for (const migration of previous) {
      applyPreviousMigration(database.name, "booking-service", migration);
      pnpmPrisma("booking-service", database.url, ["migrate", "resolve", "--applied", migration]);
    }
    const bookingId = randomUUID();
    const userId = randomUUID();
    const eventId = randomUUID();
    psql(
      database.name,
      `INSERT INTO bookings (id,user_id,event_id,quantity,status,idempotency_key) VALUES ('${bookingId}','${userId}','${eventId}',2,'PENDING','upgrade-key'); INSERT INTO booking_idempotency_keys (key,booking_id,response) VALUES ('upgrade-key','${bookingId}','{}');`
    );

    pnpmPrisma("booking-service", database.url, ["migrate", "deploy"]);
    expect(
      psql(database.name, `SELECT request_fingerprint FROM booking_idempotency_keys WHERE key='upgrade-key'`)
    ).toBe(`v1:${userId}:${eventId}:2`);
    const db = createBookingDatabase(database.url);
    await db.$connect();
    expect((await new PrismaBookingRepository(db).findById(bookingId))?.quantity).toBe(2);
    await db.$disconnect();
  });

  it("upgrades event data, preserves capacity, and boots the latest repository", async () => {
    const previous = ["20260813000000_init", "20260814_add_event_outbox", "20260817000000_harden_event_outbox"];
    for (const migration of previous) {
      applyPreviousMigration(database.name, "event-service", migration);
      pnpmPrisma("event-service", database.url, ["migrate", "resolve", "--applied", migration]);
    }
    const eventId = randomUUID();
    psql(
      database.name,
      `INSERT INTO events (id,title,date,total_seats,available_seats) VALUES ('${eventId}','Upgrade Event',NOW(),10,7)`
    );
    pnpmPrisma("event-service", database.url, ["migrate", "deploy"]);
    const db = createEventDatabase(database.url);
    await db.$connect();
    expect(await new PrismaEventRepository(db).findById(eventId)).toMatchObject({ totalSeats: 10, availableSeats: 7 });
    await db.$disconnect();
  });
});
