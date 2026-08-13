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

export class InventoryService {
  constructor(
    private readonly dependencies: InventoryDependencies,
    private readonly logger: AppLogger = createLogger("event-service")
  ) {}

  async reserveSeats(message: MessageEnvelope<ReserveSeatsPayload>): Promise<void> {
    const { repository, cache, publisher } = this.dependencies;

    if (await repository.hasProcessedMessage(message.messageId)) {
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

    const reserved = await repository.reserveSeats(message.payload.eventId, message.payload.quantity);

    if (!reserved) {
      this.logger.warn(
        {
          messageId: message.messageId,
          bookingId: message.payload.bookingId,
          eventId: message.payload.eventId,
          quantity: message.payload.quantity
        },
        "Insufficient seats for booking reservation"
      );
      const failedMessage: MessageEnvelope<SeatReservationFailedPayload> = {
        messageId: randomUUID(),
        correlationId: message.correlationId,
        timestamp: new Date().toISOString(),
        version: 1,
        payload: {
          bookingId: message.payload.bookingId,
          eventId: message.payload.eventId,
          reason: "INSUFFICIENT_SEATS"
        }
      };

      await publisher.publish(Topics.SEAT_RESERVATION_FAILED, failedMessage);
      await repository.markMessageProcessed(message.messageId);
      return;
    }

    await cache.del(message.payload.eventId);
    this.logger.info(
      {
        messageId: message.messageId,
        bookingId: message.payload.bookingId,
        eventId: message.payload.eventId,
        quantity: message.payload.quantity
      },
      "Seats reserved and event cache invalidated"
    );

    const successMessage: MessageEnvelope<SeatsReservedPayload> = {
      messageId: randomUUID(),
      correlationId: message.correlationId,
      timestamp: new Date().toISOString(),
      version: 1,
      payload: {
        bookingId: message.payload.bookingId,
        eventId: message.payload.eventId,
        quantity: message.payload.quantity
      }
    };

    await publisher.publish(Topics.SEATS_RESERVED, successMessage);
    await repository.markMessageProcessed(message.messageId);
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
    const { repository, cache } = this.dependencies;

    if (!Number.isInteger(message.payload.quantity) || message.payload.quantity <= 0) {
      throw InventoryErrors.invalidQuantity();
    }

    const result = await repository.processReleaseSeatsMessage({
      messageId: message.messageId,
      eventId: message.payload.eventId,
      quantity: message.payload.quantity
    });

    if (result.released) {
      await cache.del(message.payload.eventId);
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
    return result;
  }
}
