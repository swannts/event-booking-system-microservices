import { randomUUID } from "crypto";
import {
  Topics,
  type MessageEnvelope,
  type ReserveSeatsPayload,
  type SeatReservationFailedPayload,
  type SeatsReservedPayload
} from "@event-booking/contracts";
import { createLogger, type AppLogger } from "@event-booking/logger";
import type { EventCache } from "../../../infrastructure/cache/event-cache";
import type { MessagePublisher } from "../message-publisher";
import type { InventoryRepository } from "../../../modules/inventory/inventory.repository";

export class BookingReservationConsumer {
  constructor(
    private readonly repository: InventoryRepository,
    private readonly cache: EventCache,
    private readonly publisher: MessagePublisher,
    private readonly logger: AppLogger = createLogger("event-service")
  ) {}

  async handle(message: MessageEnvelope<ReserveSeatsPayload>): Promise<void> {
    const result = await this.repository.processReserveSeatsMessage({
      messageId: message.messageId,
      eventId: message.payload.eventId,
      quantity: message.payload.quantity
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
        messageId: randomUUID(),
        correlationId: message.correlationId,
        timestamp: new Date().toISOString(),
        version: 1,
        payload: {
          bookingId: message.payload.bookingId,
          eventId: message.payload.eventId,
          reason: result.reason === "EVENT_NOT_FOUND" ? "EVENT_NOT_FOUND" : "INSUFFICIENT_SEATS"
        }
      };

      await this.publisher.publish(Topics.SEAT_RESERVATION_FAILED, failedMessage);
      return;
    }

    await this.cache.del(message.payload.eventId);
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

    await this.publisher.publish(Topics.SEATS_RESERVED, successMessage);
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
}
