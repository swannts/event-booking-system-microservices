import { randomUUID } from "crypto";
import {
  Topics,
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
      throw InventoryErrors.insufficientSeats();
    }

    await cache.del(message.payload.eventId);
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
  }
}
