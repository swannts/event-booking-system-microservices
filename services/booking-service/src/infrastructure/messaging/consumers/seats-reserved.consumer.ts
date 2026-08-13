import { randomUUID } from "crypto";
import {
  Topics,
  type BookingConfirmedPayload,
  type BookingFailedPayload,
  type MessageEnvelope,
  type SeatReservationFailedPayload,
  type SeatsReservedPayload
} from "@event-booking/contracts";
import { createLogger, type AppLogger } from "@event-booking/logger";
import type { MessagePublisher } from "../message-publisher";
import type { BookingRepository } from "../../../modules/bookings/booking.repository";

export class BookingEventsConsumer {
  constructor(
    private readonly repository: BookingRepository,
    private readonly publisher: MessagePublisher,
    private readonly logger: AppLogger = createLogger("booking-service")
  ) {}

  async handleSeatsReserved(message: MessageEnvelope<SeatsReservedPayload>): Promise<void> {
    if (await this.repository.hasProcessedMessage(message.messageId)) {
      this.logger.info(
        {
          messageId: message.messageId,
          bookingId: message.payload.bookingId,
          eventId: message.payload.eventId
        },
        "Skipping duplicate booking confirmation message"
      );
      return;
    }

    const booking = await this.repository.updateStatus(message.payload.bookingId, "CONFIRMED");
    if (!booking) {
      this.logger.warn(
        {
          messageId: message.messageId,
          bookingId: message.payload.bookingId,
          eventId: message.payload.eventId
        },
        "Unable to confirm booking because the booking was not found"
      );
      return;
    }

    const confirmedMessage: MessageEnvelope<{ bookingId: string; eventId: string; quantity: number }> = {
      messageId: randomUUID(),
      correlationId: message.correlationId,
      timestamp: new Date().toISOString(),
      version: 1,
      payload: {
        bookingId: booking.id,
        eventId: booking.eventId,
        quantity: booking.quantity
      }
    };

    await this.publisher.publish(Topics.BOOKING_CONFIRMED, confirmedMessage);
    await this.repository.markMessageProcessed(message.messageId);
    this.logger.info(
      {
        messageId: message.messageId,
        bookingId: booking.id,
        eventId: booking.eventId
      },
      "Booking confirmed message published"
    );
  }

  async handleSeatReservationFailed(message: MessageEnvelope<SeatReservationFailedPayload>): Promise<void> {
    if (await this.repository.hasProcessedMessage(message.messageId)) {
      this.logger.info(
        {
          messageId: message.messageId,
          bookingId: message.payload.bookingId,
          eventId: message.payload.eventId
        },
        "Skipping duplicate booking failure message"
      );
      return;
    }

    const booking = await this.repository.updateStatus(message.payload.bookingId, "FAILED");
    if (!booking) {
      this.logger.warn(
        {
          messageId: message.messageId,
          bookingId: message.payload.bookingId,
          eventId: message.payload.eventId
        },
        "Unable to fail booking because the booking was not found"
      );
      return;
    }

    const failedMessage: MessageEnvelope<BookingFailedPayload> = {
      messageId: randomUUID(),
      correlationId: message.correlationId,
      timestamp: new Date().toISOString(),
      version: 1,
      payload: {
        bookingId: booking.id,
        eventId: booking.eventId,
        reason: message.payload.reason
      }
    };

    await this.publisher.publish(Topics.BOOKING_FAILED, failedMessage);
    await this.repository.markMessageProcessed(message.messageId);
    this.logger.warn(
      {
        messageId: message.messageId,
        bookingId: booking.id,
        eventId: booking.eventId,
        reason: message.payload.reason
      },
      "Booking failed message published"
    );
  }
}
