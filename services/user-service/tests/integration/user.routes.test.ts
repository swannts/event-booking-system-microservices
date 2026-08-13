import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUserApp } from "../../src/app";
import { createUserDatabase } from "../../src/config/database";

type TestContext = {
  app: Awaited<ReturnType<typeof createUserApp>>;
  db: ReturnType<typeof createUserDatabase>;
  dbPath: string;
};

async function createTestContext(): Promise<TestContext> {
  const dbDir = path.resolve(process.cwd(), ".tmp");
  fs.mkdirSync(dbDir, { recursive: true });

  const dbPath = path.join(dbDir, `user-service-${randomUUID()}.db`);
  const dbUrl = `file:${dbPath}`;
  const db = createUserDatabase(dbUrl);
  const app = await createUserApp({ db });

  return { app, db, dbPath };
}

describe("User routes", () => {
  let context: TestContext | null = null;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    if (!context) {
      return;
    }

    await context.db.$disconnect();
    fs.rmSync(context.dbPath, { force: true });
    fs.rmSync(`${context.dbPath}-wal`, { force: true });
    fs.rmSync(`${context.dbPath}-shm`, { force: true });
    context = null;
  });

  it("creates a user", async () => {
    const res = await request(context!.app)
      .post("/users")
      .send({ name: "John Doe", email: "john@example.com" })
      .expect(201);

    expect(res.body.email).toBe("john@example.com");
    expect(res.body.id).toEqual(expect.any(String));
  });

  it("rejects duplicate email", async () => {
    await request(context!.app).post("/users").send({ name: "John Doe", email: "john@example.com" }).expect(201);

    const res = await request(context!.app)
      .post("/users")
      .send({ name: "Jane Doe", email: "john@example.com" })
      .expect(409);

    expect(res.body.error.code).toBe("DUPLICATE_EMAIL");
  });

  it("retrieves an existing user", async () => {
    const created = await request(context!.app)
      .post("/users")
      .send({ name: "John Doe", email: "john@example.com" })
      .expect(201);

    const res = await request(context!.app).get(`/users/${created.body.id}`).expect(200);
    expect(res.body.email).toBe("john@example.com");
  });

  it("returns 404 for an unknown user", async () => {
    const res = await request(context!.app).get("/users/550e8400-e29b-41d4-a716-446655440000").expect(404);
    expect(res.body.error.code).toBe("USER_NOT_FOUND");
  });

  it("rejects invalid email", async () => {
    const res = await request(context!.app)
      .post("/users")
      .send({ name: "John Doe", email: "not-an-email" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
