import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { Topics, type MessageEnvelope, type ReserveSeatsPayload } from "@event-booking/contracts";
import { BookingOutboxDispatcher } from "../src/modules/bookings/booking-outbox.dispatcher";
import type { BookingOutboxRecord, BookingRepository } from "../src/infrastructure/database/booking-repository";
import type { MessagePublisher } from "../src/infrastructure/messaging/message-publisher";

function createEnvelope(): MessageEnvelope<ReserveSeatsPayload> {
  return {
    messageId: randomUUID(),
    correlationId: "booking-1",
    timestamp: new Date().toISOString(),
    version: 1,
    eventId: "event-1",
    payload: {
      bookingId: "booking-1",
      eventId: "event-1",
      userId: "user-1",
      quantity: 2
    }
  };
}

class FakeRepo {
  public events: BookingOutboxRecord[] = [
    {
      id: "outbox-1",
      topic: Topics.RESERVE_SEATS,
      messageId: "message-1",
      message: createEnvelope(),
      status: "PENDING",
      attempts: 0,
      lastError: null,
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
      publishedAt: null
    }
  ];

  async findPendingOutboxMessages(limit = 25) {
    return this.events.filter((event) => event.status === "PENDING").slice(0, limit);
  }

  async markOutboxPublished(id: string) {
    const event = this.events.find((entry) => entry.id === id);
    if (event) {
      event.status = "PUBLISHED";
      event.publishedAt = new Date().toISOString();
      event.lastError = null;
    }
  }

  async recordOutboxFailure(id: string, error: string) {
    const event = this.events.find((entry) => entry.id === id);
    if (event) {
      event.attempts += 1;
      event.lastError = error;
      event.status = "PENDING";
    }
  }
}

class FakePublisher implements MessagePublisher {
  public published: Array<{ topic: string; message: unknown }> = [];
  public shouldFail = false;

  async publish(topic: string, message: unknown): Promise<void> {
    if (this.shouldFail) {
      throw new Error("publish failed");
    }

    this.published.push({ topic, message });
  }
}

describe("BookingOutboxDispatcher", () => {
  it("publishes pending outbox messages and marks them as published", async () => {
    const repo = new FakeRepo() as unknown as BookingRepository;
    const publisher = new FakePublisher();
    const dispatcher = new BookingOutboxDispatcher(repo, publisher);

    await dispatcher.dispatchPending();

    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]?.topic).toBe(Topics.RESERVE_SEATS);
    expect((repo as unknown as FakeRepo).events[0]?.status).toBe("PUBLISHED");
  });

  it("records failures without losing the outbox row", async () => {
    const repo = new FakeRepo() as unknown as BookingRepository;
    const publisher = new FakePublisher();
    publisher.shouldFail = true;
    const dispatcher = new BookingOutboxDispatcher(repo, publisher);

    await dispatcher.dispatchPending();

    expect(publisher.published).toHaveLength(0);
    expect((repo as unknown as FakeRepo).events[0]?.status).toBe("PENDING");
    expect((repo as unknown as FakeRepo).events[0]?.attempts).toBe(1);
    expect((repo as unknown as FakeRepo).events[0]?.lastError).toBe("publish failed");
  });
});
