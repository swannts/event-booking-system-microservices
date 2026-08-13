import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { Topics, type MessageEnvelope, type ReserveSeatsPayload } from "@event-booking/contracts";
import { BookingReservationConsumer } from "../../src/infrastructure/messaging/consumers/reserve-seats.consumer";
import type { EventCache } from "../../src/infrastructure/cache/event-cache";
import type { MessagePublisher } from "../../src/infrastructure/messaging/message-publisher";
import type { InventoryRepository } from "../../src/modules/inventory/inventory.repository";
import { InventoryErrors } from "../../src/modules/inventory/inventory.errors";

type EventDto = {
  id: string;
  title: string;
  date: string;
  totalSeats: number;
  availableSeats: number;
  createdAt: string;
  updatedAt: string;
};

function createMessage(overrides: Partial<MessageEnvelope<ReserveSeatsPayload>> = {}): MessageEnvelope<ReserveSeatsPayload> {
  const eventId = overrides.payload?.eventId ?? "event-1";
  const bookingId = overrides.payload?.bookingId ?? "booking-1";

  return {
    messageId: overrides.messageId ?? randomUUID(),
    correlationId: overrides.correlationId ?? "booking-1",
    timestamp: overrides.timestamp ?? "2026-08-13T00:00:00.000Z",
    version: overrides.version ?? 1,
    payload: {
      bookingId,
      eventId,
      userId: overrides.payload?.userId ?? "user-1",
      quantity: overrides.payload?.quantity ?? 2
    }
  };
}

class FakeRepository implements Pick<InventoryRepository, "hasProcessedMessage" | "reserveSeats" | "markMessageProcessed"> {
  public hasProcessedMessage = vi.fn();
  public reserveSeats = vi.fn();
  public markMessageProcessed = vi.fn();
}

class FakeCache implements Pick<EventCache, "del"> {
  public del = vi.fn();
}

class FakePublisher implements Pick<MessagePublisher, "publish"> {
  public publish = vi.fn();
}

describe("BookingReservationConsumer", () => {
  let repository: FakeRepository;
  let cache: FakeCache;
  let publisher: FakePublisher;
  let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
  let consumer: BookingReservationConsumer;

  beforeEach(() => {
    repository = new FakeRepository();
    cache = new FakeCache();
    publisher = new FakePublisher();
    logger = {
      info: vi.fn(),
      warn: vi.fn()
    };
    consumer = new BookingReservationConsumer(
      repository as unknown as InventoryRepository,
      cache as unknown as EventCache,
      publisher as unknown as MessagePublisher,
      logger as never
    );
  });

  it("handles a successful seat reservation, invalidates cache, preserves correlation id, and records the message", async () => {
    const message = createMessage({ correlationId: "corr-123" });
    repository.hasProcessedMessage.mockResolvedValue(false);
    repository.reserveSeats.mockResolvedValue({
      id: "event-1",
      title: "Node.js Conference",
      date: "2026-09-20T10:00:00.000Z",
      totalSeats: 10,
      availableSeats: 8,
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z"
    } satisfies EventDto);

    await consumer.handle(message);

    expect(repository.hasProcessedMessage).toHaveBeenCalledWith(message.messageId);
    expect(repository.reserveSeats).toHaveBeenCalledWith(message.payload.eventId, message.payload.quantity);
    expect(cache.del).toHaveBeenCalledWith(message.payload.eventId);
    expect(repository.markMessageProcessed).toHaveBeenCalledWith(message.messageId);
    expect(publisher.publish).toHaveBeenCalledWith(
      Topics.SEATS_RESERVED,
      expect.objectContaining({
        correlationId: "corr-123",
        payload: {
          bookingId: message.payload.bookingId,
          eventId: message.payload.eventId,
          quantity: message.payload.quantity
        }
      })
    );
    expect(logger.info).toHaveBeenCalled();
  });

  it("publishes a failure event, records the message, and throws on insufficient seats", async () => {
    const message = createMessage({ correlationId: "corr-456" });
    repository.hasProcessedMessage.mockResolvedValue(false);
    repository.reserveSeats.mockResolvedValue(null);
    publisher.publish.mockResolvedValue(undefined);

    await expect(consumer.handle(message)).resolves.toBeUndefined();

    expect(publisher.publish).toHaveBeenCalledWith(
      Topics.SEAT_RESERVATION_FAILED,
      expect.objectContaining({
        correlationId: "corr-456",
        payload: {
          bookingId: message.payload.bookingId,
          eventId: message.payload.eventId,
          reason: "INSUFFICIENT_SEATS"
        }
      })
    );
    expect(cache.del).not.toHaveBeenCalled();
    expect(repository.markMessageProcessed).toHaveBeenCalledWith(message.messageId);
  });

  it("propagates publisher failures during successful reservations", async () => {
    const message = createMessage();
    repository.hasProcessedMessage.mockResolvedValue(false);
    repository.reserveSeats.mockResolvedValue({
      id: "event-1",
      title: "Node.js Conference",
      date: "2026-09-20T10:00:00.000Z",
      totalSeats: 10,
      availableSeats: 8,
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z"
    } satisfies EventDto);
    publisher.publish.mockRejectedValue(new Error("kafka down"));

    await expect(consumer.handle(message)).rejects.toThrow("kafka down");
    expect(repository.markMessageProcessed).not.toHaveBeenCalled();
  });

  it("ignores duplicate messages", async () => {
    const message = createMessage();
    repository.hasProcessedMessage.mockResolvedValue(true);

    await consumer.handle(message);

    expect(repository.reserveSeats).not.toHaveBeenCalled();
    expect(cache.del).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: message.messageId,
        bookingId: message.payload.bookingId,
        eventId: message.payload.eventId
      }),
      "Skipping duplicate reserve seats message"
    );
  });
});
