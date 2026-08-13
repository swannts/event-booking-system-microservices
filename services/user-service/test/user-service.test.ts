import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import { newDb } from "pg-mem";
import { createUserApp } from "../src/app";

async function createTestApp() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const pool = db.adapters.createPg().Pool;
  const app = await createUserApp({ db: new pool() });
  return { app, db };
}

describe("User Service", () => {
  let app: Awaited<ReturnType<typeof createUserApp>>;

  beforeEach(async () => {
    const created = await createTestApp();
    app = created.app;
  });

  it("creates a user", async () => {
    const res = await request(app)
      .post("/users")
      .send({ name: "John Doe", email: "john@example.com" })
      .expect(201);

    expect(res.body.email).toBe("john@example.com");
    expect(res.body.id).toBeTypeOf("string");
  });

  it("rejects duplicate email", async () => {
    await request(app).post("/users").send({ name: "John Doe", email: "john@example.com" }).expect(201);

    const res = await request(app)
      .post("/users")
      .send({ name: "Jane Doe", email: "john@example.com" })
      .expect(409);

    expect(res.body.error.code).toBe("DUPLICATE_EMAIL");
  });

  it("retrieves existing user", async () => {
    const created = await request(app)
      .post("/users")
      .send({ name: "John Doe", email: "john@example.com" })
      .expect(201);

    const res = await request(app).get(`/users/${created.body.id}`).expect(200);
    expect(res.body.email).toBe("john@example.com");
  });

  it("returns 404 for unknown user", async () => {
    const res = await request(app).get("/users/550e8400-e29b-41d4-a716-446655440000").expect(404);
    expect(res.body.error.code).toBe("USER_NOT_FOUND");
  });

  it("rejects invalid email", async () => {
    const res = await request(app)
      .post("/users")
      .send({ name: "John Doe", email: "not-an-email" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
