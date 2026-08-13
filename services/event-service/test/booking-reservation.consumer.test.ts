import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import {
  Topics,
  type MessageEnvelope,
  type ReserveSeatsPayload
} from "@event-booking/contracts";
import { BookingReservationConsumer } from "../src/modules/events/booking-reservation.consumer";
import type { EventCache } from "../src/infrastructure/cache/event-cache";
import type { MessagePublisher } from "../src/infrastructure/messaging/message-publisher";
import type { EventRepository } from "../src/infrastructure/database/event-repository";

class FakeRepo {
  public processed = new Set<string>();
  public reserved = 0;
  constructor(private readonly shouldReserve: boolean) {}

  async hasProcessedMessage(messageId: string) {
    return this.processed.has(messageId);
  }

  async reserveSeats() {
    return this.shouldReserve
      ? {
          id: "event-1",
          title: "Node.js Conference",
          date: "2026-09-20T10:00:00Z",
          totalSeats: 10,
          availableSeats: 5,
          createdAt: "2026-08-13T00:00:00.000Z",
          updatedAt: "2026-08-13T00:00:00.000Z"
        }
      : null;
  }

  async markMessageProcessed(messageId: string) {
    this.processed.add(messageId);
  }
}

class FakeCache implements EventCache {
  public deleted: string[] = [];
  async get() {
    return null;
  }
  async set() {
    return;
  }
  async del(eventId: string) {
    this.deleted.push(eventId);
  }
}

class FakePublisher implements MessagePublisher {
  public messages: Array<{ topic: string; message: unknown }> = [];
  async publish(topic: any, message: any) {
    this.messages.push({ topic, message });
  }
}

function createMessage(eventId = "event-1"): MessageEnvelope<ReserveSeatsPayload> {
  return {
    messageId: randomUUID(),
    correlationId: "booking-1",
    timestamp: new Date().toISOString(),
    version: 1,
    payload: {
      bookingId: "booking-1",
      eventId,
      userId: "user-1",
      quantity: 2
    }
  };
}

describe("BookingReservationConsumer", () => {
  it("publishes seats reserved on success", async () => {
    const repo = new FakeRepo(true) as unknown as EventRepository;
    const cache = new FakeCache();
    const publisher = new FakePublisher();
    const consumer = new BookingReservationConsumer(repo, cache, publisher);

    const message = createMessage();
    await consumer.handle(message);

    expect(cache.deleted).toEqual(["event-1"]);
    expect(publisher.messages[0]?.topic).toBe(Topics.SEATS_RESERVED);
  });

  it("publishes reservation failed on shortage", async () => {
    const repo = new FakeRepo(false) as unknown as EventRepository;
    const cache = new FakeCache();
    const publisher = new FakePublisher();
    const consumer = new BookingReservationConsumer(repo, cache, publisher);

    await consumer.handle(createMessage());

    expect(publisher.messages[0]?.topic).toBe(Topics.SEAT_RESERVATION_FAILED);
  });

  it("skips duplicate messages", async () => {
    const repo = new FakeRepo(true) as unknown as EventRepository;
    const cache = new FakeCache();
    const publisher = new FakePublisher();
    const consumer = new BookingReservationConsumer(repo, cache, publisher);

    const message = createMessage();
    await consumer.handle(message);
    await consumer.handle(message);

    expect(publisher.messages).toHaveLength(1);
  });
});
