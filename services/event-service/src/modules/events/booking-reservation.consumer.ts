import { randomUUID } from "crypto";
import {
  Topics,
  type MessageEnvelope,
  type ReserveSeatsPayload,
  type SeatReservationFailedPayload,
  type SeatsReservedPayload
} from "@event-booking/contracts";
import { createLogger, type AppLogger } from "@event-booking/logger";
import type { EventCache } from "../../infrastructure/cache/event-cache";
import type { MessagePublisher } from "../../infrastructure/messaging/message-publisher";
import type { EventRepository } from "../../infrastructure/database/event-repository";

export class BookingReservationConsumer {
  constructor(
    private readonly repository: EventRepository,
    private readonly cache: EventCache,
    private readonly publisher: MessagePublisher,
    private readonly logger: AppLogger = createLogger("event-service")
  ) {}

  async handle(message: MessageEnvelope<ReserveSeatsPayload>): Promise<void> {
    if (await this.repository.hasProcessedMessage(message.messageId)) {
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

    const reserved = await this.repository.reserveSeats(message.payload.eventId, message.payload.quantity);

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

      await this.publisher.publish(Topics.SEAT_RESERVATION_FAILED, failedMessage);
      await this.repository.markMessageProcessed(message.messageId);
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
    await this.repository.markMessageProcessed(message.messageId);
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
