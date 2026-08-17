import { randomUUID } from "crypto";
import {
  Topics,
  type BookingCancelledPayload,
  type MessageEnvelope,
  type ReserveSeatsPayload,
  type SeatReservationFailedPayload,
  type SeatsReservedPayload
} from "@event-booking/contracts";
import { createLogger, type AppLogger } from "@event-booking/logger";
import { InventoryErrors } from "./inventory.errors";
import type { InventoryDependencies } from "./inventory.types";
import { observeDomain } from "@event-booking/observability";

export class InventoryService {
  constructor(
    private readonly dependencies: InventoryDependencies,
    private readonly logger: AppLogger = createLogger("event-service")
  ) {}

  private async invalidateCache(eventId: string): Promise<void> {
    try {
      await this.dependencies.cache.del(eventId);
    } catch (error) {
      this.logger.warn(
        { eventId, error },
        "Event cache invalidation failed; database result remains authoritative and cache will expire by TTL"
      );
    }
  }

  async reserveSeats(message: MessageEnvelope<ReserveSeatsPayload>): Promise<void> {
    const { repository, publisher } = this.dependencies;

    const successMessageId = randomUUID();
    const successMessage: MessageEnvelope<SeatsReservedPayload> = {
      messageId: successMessageId,
      correlationId: message.correlationId,
      timestamp: new Date().toISOString(),
      version: 1,
      payload: {
        bookingId: message.payload.bookingId,
        eventId: message.payload.eventId,
        quantity: message.payload.quantity
      }
    };

    const failedMessageId = randomUUID();

    const result = await repository.processReserveSeatsMessage({
      messageId: message.messageId,
      eventId: message.payload.eventId,
      quantity: message.payload.quantity,
      outboxOnSuccess: {
        id: randomUUID(),
        topic: Topics.SEATS_RESERVED,
        messageId: successMessageId,
        message: successMessage
      },
      outboxOnFailure: {
        id: randomUUID(),
        topic: Topics.SEAT_RESERVATION_FAILED,
        messageId: failedMessageId,
        correlationId: message.correlationId,
        bookingId: message.payload.bookingId
      }
    });

    if (result.duplicate) {
      this.logger.info(
        {
          messageId: message.messageId,
          bookingId: message.payload.bookingId,
          eventId: message.payload.eventId
        },
        "Skipping duplicate reserve seats message"
      );
      return;
    }

    if (!result.reserved) {
      observeDomain("event-service", "seat_reservation", "failure");
      this.logger.warn(
        {
          messageId: message.messageId,
          bookingId: message.payload.bookingId,
          eventId: message.payload.eventId,
          quantity: message.payload.quantity,
          reason: result.reason
        },
        "Insufficient seats for booking reservation"
      );
      const failedMessage: MessageEnvelope<SeatReservationFailedPayload> = {
        messageId: failedMessageId,
        correlationId: message.correlationId,
        timestamp: new Date().toISOString(),
        version: 1,
        payload: {
          bookingId: message.payload.bookingId,
          eventId: message.payload.eventId,
          reason: result.reason === "EVENT_NOT_FOUND" ? "EVENT_NOT_FOUND" : "INSUFFICIENT_SEATS"
        }
      };

      await publisher.publish(Topics.SEAT_RESERVATION_FAILED, failedMessage);
      if (result.outboxRowId) {
        await repository.markOutboxPublished(result.outboxRowId);
      }
      return;
    }

    observeDomain("event-service", "seat_reservation", "success");
    await this.invalidateCache(message.payload.eventId);
    this.logger.info(
      {
        messageId: message.messageId,
        bookingId: message.payload.bookingId,
        eventId: message.payload.eventId,
        quantity: message.payload.quantity
      },
      "Seats reserved and event cache invalidated"
    );

    await publisher.publish(Topics.SEATS_RESERVED, successMessage);
    if (result.outboxRowId) {
      await repository.markOutboxPublished(result.outboxRowId);
    }
    this.logger.info(
      {
        messageId: message.messageId,
        bookingId: message.payload.bookingId,
        eventId: message.payload.eventId,
        quantity: message.payload.quantity
      },
      "Reservation success message published"
    );
  }

  async releaseSeats(message: MessageEnvelope<BookingCancelledPayload>) {
    const { repository } = this.dependencies;

    if (!Number.isInteger(message.payload.quantity) || message.payload.quantity <= 0) {
      throw InventoryErrors.invalidQuantity();
    }

    const result = await repository.processReleaseSeatsMessage({
      messageId: message.messageId,
      eventId: message.payload.eventId,
      quantity: message.payload.quantity
    });

    if (result.released) {
      observeDomain("event-service", "seat_release", "success");
      await this.invalidateCache(message.payload.eventId);
      this.logger.info(
        {
          messageId: message.messageId,
          bookingId: message.payload.bookingId,
          eventId: message.payload.eventId,
          quantity: message.payload.quantity
        },
        "Seats released and event cache invalidated"
      );
      return result;
    }

    if (result.duplicate) {
      this.logger.info(
        {
          messageId: message.messageId,
          bookingId: message.payload.bookingId,
          eventId: message.payload.eventId,
          quantity: message.payload.quantity
        },
        "Skipping duplicate release seats message"
      );
      return result;
    }

    this.logger.warn(
      {
        messageId: message.messageId,
        bookingId: message.payload.bookingId,
        eventId: message.payload.eventId,
        quantity: message.payload.quantity,
        reason: result.reason
      },
      "Release seats message rejected"
    );
    observeDomain("event-service", "seat_release", "failure");
    return result;
  }
}
