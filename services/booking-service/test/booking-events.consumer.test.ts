import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import {
  Topics,
  type MessageEnvelope,
  type SeatReservationFailedPayload,
  type SeatsReservedPayload
} from "@event-booking/contracts";
import { BookingEventsConsumer } from "../src/modules/bookings/booking-events.consumer";
import type { MessagePublisher } from "../src/infrastructure/messaging/message-publisher";
import type { BookingRepository } from "../src/infrastructure/database/booking-repository";

type BookingState = {
  id: string;
  eventId: string;
  quantity: number;
  status: "PENDING" | "CONFIRMED" | "FAILED" | "CANCELLED" | "EXPIRED";
};

class FakeRepo {
  public processed = new Set<string>();
  public booking: BookingState = {
    id: "booking-1",
    eventId: "event-1",
    quantity: 2,
    status: "PENDING"
  };

  async hasProcessedMessage(messageId: string) {
    return this.processed.has(messageId);
  }

  async updateStatus(_id: string, status: BookingState["status"]) {
    this.booking.status = status;
    return {
      id: this.booking.id,
      userId: "user-1",
      eventId: this.booking.eventId,
      quantity: this.booking.quantity,
      status,
      idempotencyKey: null,
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z"
    };
  }

  async markMessageProcessed(messageId: string) {
    this.processed.add(messageId);
  }
}

class FakePublisher implements MessagePublisher {
  public messages: Array<{ topic: string; message: unknown }> = [];
  async publish(topic: any, message: any) {
    this.messages.push({ topic, message });
  }
}

function createSeatsReservedMessage(): MessageEnvelope<SeatsReservedPayload> {
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

function createReservationFailedMessage(): MessageEnvelope<SeatReservationFailedPayload> {
  return {
    messageId: randomUUID(),
    correlationId: "booking-1",
    timestamp: new Date().toISOString(),
    version: 1,
    payload: {
      bookingId: "booking-1",
      eventId: "event-1",
      reason: "INSUFFICIENT_SEATS"
    }
  };
}

describe("BookingEventsConsumer", () => {
  it("confirms booking on seat reservation success", async () => {
    const repo = new FakeRepo() as unknown as BookingRepository;
    const publisher = new FakePublisher();
    const consumer = new BookingEventsConsumer(repo, publisher);

    await consumer.handleSeatsReserved(createSeatsReservedMessage());

    expect((repo as unknown as FakeRepo).booking.status).toBe("CONFIRMED");
    expect(publisher.messages[0]?.topic).toBe(Topics.BOOKING_CONFIRMED);
  });

  it("fails booking on seat reservation failure", async () => {
    const repo = new FakeRepo() as unknown as BookingRepository;
    const publisher = new FakePublisher();
    const consumer = new BookingEventsConsumer(repo, publisher);

    await consumer.handleSeatReservationFailed(createReservationFailedMessage());

    expect((repo as unknown as FakeRepo).booking.status).toBe("FAILED");
    expect(publisher.messages[0]?.topic).toBe(Topics.BOOKING_FAILED);
  });

  it("skips duplicate messages", async () => {
    const repo = new FakeRepo() as unknown as BookingRepository;
    const publisher = new FakePublisher();
    const consumer = new BookingEventsConsumer(repo, publisher);
    const message = createSeatsReservedMessage();

    await consumer.handleSeatsReserved(message);
    await consumer.handleSeatsReserved(message);

    expect(publisher.messages).toHaveLength(1);
  });
});
