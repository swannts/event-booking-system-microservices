import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUserApp } from "../../src/app";
import { FakeUserDatabase } from "../mocks/user-db.mock";
import type { UserDatabase } from "../../src/config/database";

type TestContext = {
  app: Awaited<ReturnType<typeof createUserApp>>;
  db: FakeUserDatabase;
};

async function createTestContext(): Promise<TestContext> {
  const db = new FakeUserDatabase();
  const app = await createUserApp({ db: db as unknown as UserDatabase });

  return { app, db };
}

describe("User routes", () => {
  let context: TestContext | null = null;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    if (context) {
      await context.db.$disconnect();
      context = null;
    }
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

  it("normalizes email casing and whitespace before enforcing uniqueness", async () => {
    const first = await request(context!.app)
      .post("/users")
      .send({ name: "John Doe", email: "  User@Example.com " })
      .expect(201);

    expect(first.body.email).toBe("user@example.com");
    const duplicate = await request(context!.app)
      .post("/users")
      .send({ name: "Jane Doe", email: "user@example.com" })
      .expect(409);
    expect(duplicate.body.error.code).toBe("DUPLICATE_EMAIL");
  });

  it("uses bounded, stable pagination for user lists", async () => {
    await request(context!.app).post("/users").send({ name: "First", email: "first@example.com" }).expect(201);
    await request(context!.app).post("/users").send({ name: "Second", email: "second@example.com" }).expect(201);

    const firstPage = await request(context!.app).get("/users?page=1&pageSize=1").expect(200);
    const secondPage = await request(context!.app).get("/users?page=2&pageSize=1").expect(200);
    expect(firstPage.body).toHaveLength(1);
    expect(secondPage.body).toHaveLength(1);
    expect(secondPage.body[0].id).not.toBe(firstPage.body[0].id);
    await request(context!.app).get("/users?pageSize=101").expect(400);
  });

  it("reports dependency readiness and exposes Prometheus metrics", async () => {
    const readiness = await request(context!.app).get("/health/ready").expect(200);
    expect(readiness.body).toEqual({ status: "ready", checks: { database: "ok" } });

    const metrics = await request(context!.app).get("/metrics").expect(200);
    expect(metrics.text).toContain("event_booking_http_requests_total");
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
