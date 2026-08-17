import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import {
  type BookingCancelledPayload,
  type BookingConfirmedPayload,
  type BookingFailedPayload,
  type MessageEnvelope
} from "@event-booking/contracts";
import { createNotificationConsumer } from "../../src/modules/notifications/notification-consumer";
import { InMemoryNotificationStore } from "../../src/infrastructure/notifications/notification-store";

function confirmedMessage(): MessageEnvelope<BookingConfirmedPayload> {
  return {
    messageId: randomUUID(),
    correlationId: "booking-1",
    timestamp: new Date().toISOString(),
    version: 1,
    payload: {
      bookingId: "booking-1",
      eventId: "event-1",
      quantity: 2
    }
  };
}

function failedMessage(): MessageEnvelope<BookingFailedPayload> {
  return {
    messageId: randomUUID(),
    correlationId: "booking-2",
    timestamp: new Date().toISOString(),
    version: 1,
    payload: {
      bookingId: "booking-2",
      eventId: "event-1",
      reason: "INSUFFICIENT_SEATS"
    }
  };
}

function cancelledMessage(): MessageEnvelope<BookingCancelledPayload> {
  return {
    messageId: randomUUID(),
    correlationId: "booking-3",
    timestamp: new Date().toISOString(),
    version: 1,
    payload: {
      bookingId: "booking-3",
      eventId: "event-1",
      quantity: 1
    }
  };
}

describe("Notification consumer", () => {
  it("stores confirmed booking notifications", async () => {
    const store = new InMemoryNotificationStore();
    const consumer = createNotificationConsumer(store);

    await consumer.handleBookingConfirmed(confirmedMessage());

    const [notification] = await store.list();
    expect(notification?.type).toBe("BOOKING_CONFIRMED");
    expect(notification?.message).toBe("Booking confirmed");
  });

  it("stores failed booking notifications", async () => {
    const store = new InMemoryNotificationStore();
    const consumer = createNotificationConsumer(store);

    await consumer.handleBookingFailed(failedMessage());

    const [notification] = await store.list();
    expect(notification?.type).toBe("BOOKING_FAILED");
    expect(notification?.reason).toBe("INSUFFICIENT_SEATS");
  });

  it("stores cancelled booking notifications and ignores duplicates", async () => {
    const store = new InMemoryNotificationStore();
    const consumer = createNotificationConsumer(store);
    const message = cancelledMessage();

    await consumer.handleBookingCancelled(message);
    await consumer.handleBookingCancelled(message);

    const notifications = await store.list();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe("BOOKING_CANCELLED");
    expect(notifications[0]?.messageId).toBe(message.messageId);
  });
});
