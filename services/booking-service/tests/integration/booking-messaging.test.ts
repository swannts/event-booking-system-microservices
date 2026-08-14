import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import {
  Topics,
  type BookingConfirmedPayload,
  type BookingFailedPayload,
  type MessageEnvelope,
  type SeatReservationFailedPayload,
  type SeatsReservedPayload
} from "@event-booking/contracts";
import { BookingEventsConsumer } from "../../src/infrastructure/messaging/consumers/seats-reserved.consumer";
import type { BookingOutboxDispatcher } from "../../src/modules/bookings/booking-outbox.dispatcher";
import type {
  BookingRepository,
  ProcessSeatReservationFailedResult,
  ProcessSeatsReservedResult
} from "../../src/modules/bookings/booking.repository";

type BookingState = {
  id: string;
  userId: string;
  eventId: string;
  quantity: number;
  status: "PENDING" | "CONFIRMED" | "FAILED" | "CANCELLED";
};

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

class FakeRepo implements Pick<BookingRepository, "processSeatsReservedMessage" | "processSeatReservationFailedMessage"> {
  public readonly booking: BookingState = {
    id: "booking-1",
    userId: "user-1",
    eventId: "event-1",
    quantity: 2,
    status: "PENDING"
  };

  public readonly processed = new Set<string>();
  public readonly outboxMessages: Array<{ topic: string; message: unknown }> = [];

  async processSeatsReservedMessage(input: {
    messageId: string;
    bookingId: string;
    eventId: string;
    quantity: number;
    outboxOnSuccess: { id: string; topic: string; message: MessageEnvelope<BookingConfirmedPayload> };
  }): Promise<ProcessSeatsReservedResult> {
    if (this.processed.has(input.messageId)) {
      return { duplicate: true, confirmed: false, reason: "DUPLICATE_MESSAGE" };
    }

    this.processed.add(input.messageId);

    if (this.booking.id !== input.bookingId || this.booking.eventId !== input.eventId || this.booking.quantity !== input.quantity) {
      return { duplicate: false, confirmed: false, reason: "INVALID_STATUS" };
    }

    this.booking.status = "CONFIRMED";
    this.outboxMessages.push({ topic: Topics.BOOKING_CONFIRMED, message: input.outboxOnSuccess.message });
    return {
      duplicate: false,
      confirmed: true,
      booking: {
        ...this.booking,
        createdAt: new Date("2026-08-13T00:00:00.000Z").toISOString(),
        updatedAt: new Date("2026-08-13T00:00:00.000Z").toISOString(),
        idempotencyKey: null
      },
      outboxRowId: input.outboxOnSuccess.id
    };
  }

  async processSeatReservationFailedMessage(input: {
    messageId: string;
    bookingId: string;
    eventId: string;
    reason: "INSUFFICIENT_SEATS" | "EVENT_NOT_FOUND";
    outboxOnFailure: { id: string; topic: string; message: MessageEnvelope<BookingFailedPayload> };
  }): Promise<ProcessSeatReservationFailedResult> {
    if (this.processed.has(input.messageId)) {
      return { duplicate: true, failed: false, reason: "DUPLICATE_MESSAGE" };
    }

    this.processed.add(input.messageId);

    if (this.booking.id !== input.bookingId || this.booking.eventId !== input.eventId || this.booking.status !== "PENDING") {
      return { duplicate: false, failed: false, reason: "INVALID_STATUS" };
    }

    this.booking.status = "FAILED";
    this.outboxMessages.push({ topic: Topics.BOOKING_FAILED, message: input.outboxOnFailure.message });
    return {
      duplicate: false,
      failed: true,
      booking: {
        ...this.booking,
        createdAt: new Date("2026-08-13T00:00:00.000Z").toISOString(),
        updatedAt: new Date("2026-08-13T00:00:00.000Z").toISOString(),
        idempotencyKey: null
      },
      outboxRowId: input.outboxOnFailure.id
    };
  }
}

class FakeDispatcher {
  public dispatchCount = 0;

  async dispatchPending() {
    this.dispatchCount += 1;
  }
}

describe("BookingEventsConsumer", () => {
  it("confirms booking on seat reservation success", async () => {
    const repo = new FakeRepo();
    const dispatcher = new FakeDispatcher();
    const consumer = new BookingEventsConsumer(repo, dispatcher as unknown as BookingOutboxDispatcher);

    await consumer.handleSeatsReserved(createSeatsReservedMessage());

    expect(repo.booking.status).toBe("CONFIRMED");
    expect(dispatcher.dispatchCount).toBe(1);
    expect(repo.outboxMessages[0]?.topic).toBe(Topics.BOOKING_CONFIRMED);
  });

  it("fails booking on seat reservation failure", async () => {
    const repo = new FakeRepo();
    const dispatcher = new FakeDispatcher();
    const consumer = new BookingEventsConsumer(repo, dispatcher as unknown as BookingOutboxDispatcher);

    await consumer.handleSeatReservationFailed(createReservationFailedMessage());

    expect(repo.booking.status).toBe("FAILED");
    expect(dispatcher.dispatchCount).toBe(1);
    expect(repo.outboxMessages[0]?.topic).toBe(Topics.BOOKING_FAILED);
  });

  it("skips duplicate messages", async () => {
    const repo = new FakeRepo();
    const dispatcher = new FakeDispatcher();
    const consumer = new BookingEventsConsumer(repo, dispatcher as unknown as BookingOutboxDispatcher);
    const message = createSeatsReservedMessage();

    await consumer.handleSeatsReserved(message);
    await consumer.handleSeatsReserved(message);

    expect(dispatcher.dispatchCount).toBe(1);
    expect(repo.outboxMessages).toHaveLength(1);
  });
});
