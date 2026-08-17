import request from "supertest";
import { describe, expect, it } from "vitest";
import { createNotificationApp } from "../../src/app";
import { InMemoryNotificationStore } from "../../src/infrastructure/notifications/notification-store";

function notification(index: number) {
  return {
    timestamp: new Date(1_700_000_000_000 + index).toISOString(),
    service: "notification-service" as const,
    level: "info" as const,
    message: "Booking confirmed",
    type: "BOOKING_CONFIRMED" as const,
    messageId: `message-${index}`,
    correlationId: `correlation-${index}`,
    bookingId: `booking-${index}`,
    eventId: `event-${index}`
  };
}

describe("Notification routes", () => {
  it("uses bounded pagination with stable insertion ordering", async () => {
    const sink = new InMemoryNotificationStore();
    await sink.appendIfUnprocessed(notification(1));
    await sink.appendIfUnprocessed(notification(2));
    const app = await createNotificationApp({ sink });

    const first = await request(app).get("/notifications?page=1&pageSize=1").expect(200);
    const second = await request(app).get("/notifications?page=2&pageSize=1").expect(200);
    expect(first.body.map((item: { messageId: string }) => item.messageId)).toEqual(["message-1"]);
    expect(second.body.map((item: { messageId: string }) => item.messageId)).toEqual(["message-2"]);
    await request(app).get("/notifications?pageSize=101").expect(400);
  });

  it("reports database and Kafka readiness without coupling liveness", async () => {
    const app = await createNotificationApp({
      sink: new InMemoryNotificationStore(),
      readiness: async () => {
        throw new Error("database unavailable");
      },
      kafkaReady: () => false
    });

    expect((await request(app).get("/health/ready").expect(503)).body).toEqual({
      status: "not_ready",
      checks: { database: "failed", kafka: "failed" }
    });
    await request(app).get("/health/live").expect(200);
  });

  it("exposes Prometheus metrics", async () => {
    const app = await createNotificationApp({ sink: new InMemoryNotificationStore() });
    const response = await request(app).get("/metrics").expect(200);
    expect(response.text).toContain("event_booking_http_request_duration_seconds");
  });
});
