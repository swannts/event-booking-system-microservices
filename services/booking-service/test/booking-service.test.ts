import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { newDb } from "pg-mem";
import { createBookingApp } from "../src/app";
import type { MessagePublisher } from "../src/infrastructure/messaging/message-publisher";

class FakePublisher implements MessagePublisher {
  public published: Array<{ topic: string; message: unknown }> = [];

  async publish<TPayload>(topic: string, message: { payload: TPayload }) {
    this.published.push({ topic, message });
  }
}

async function createTestApp() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const publisher = new FakePublisher();
  const app = await createBookingApp({ db: pool, publisher });
  return { app, publisher, db: pool };
}

describe("Booking Service", () => {
  let app: Awaited<ReturnType<typeof createBookingApp>>;
  let publisher: FakePublisher;

  beforeEach(async () => {
    const created = await createTestApp();
    app = created.app;
    publisher = created.publisher;
  });

  it("creates a pending booking and publishes reserve seats", async () => {
    const res = await request(app)
      .post("/bookings")
      .send({
        userId: "550e8400-e29b-41d4-a716-446655440000",
        eventId: "550e8400-e29b-41d4-a716-446655440001",
        quantity: 2
      })
      .expect(201);

    expect(res.body.status).toBe("PENDING");
    expect(publisher.published[0]?.topic).toBe("booking.reserve-seats");
  });

  it("returns the same booking for the same idempotency key", async () => {
    const input = {
      userId: "550e8400-e29b-41d4-a716-446655440000",
      eventId: "550e8400-e29b-41d4-a716-446655440001",
      quantity: 2
    };

    const first = await request(app).post("/bookings").set("Idempotency-Key", "abc").send(input).expect(201);
    const second = await request(app).post("/bookings").set("Idempotency-Key", "abc").send(input).expect(201);

    expect(second.body.id).toBe(first.body.id);
  });

  it("rejects cancellation of a non-confirmed booking", async () => {
    const created = await request(app)
      .post("/bookings")
      .send({
        userId: "550e8400-e29b-41d4-a716-446655440000",
        eventId: "550e8400-e29b-41d4-a716-446655440001",
        quantity: 2
      })
      .expect(201);

    await request(app).post(`/bookings/${created.body.id}/cancel`).expect(409);
  });
});
