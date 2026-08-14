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
import type { BookingOutboxDispatcher } from "../../../modules/bookings/booking-outbox.dispatcher";
import type { BookingRepository } from "../../../modules/bookings/booking.repository";

export class BookingEventsConsumer {
  constructor(
    private readonly repository: BookingRepository,
    private readonly outboxDispatcher: BookingOutboxDispatcher,
    private readonly logger: AppLogger = createLogger("booking-service")
  ) {}

  async handleSeatsReserved(message: MessageEnvelope<SeatsReservedPayload>): Promise<void> {
    const confirmedMessage: MessageEnvelope<BookingConfirmedPayload> = {
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

    const result = await this.repository.processSeatsReservedMessage({
      messageId: message.messageId,
      bookingId: message.payload.bookingId,
      eventId: message.payload.eventId,
      quantity: message.payload.quantity,
      outboxOnSuccess: {
        id: randomUUID(),
        topic: Topics.BOOKING_CONFIRMED,
        message: confirmedMessage
      }
    });

    if (result.duplicate) {
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

    if (!result.confirmed) {
      this.logger.warn(
        {
          messageId: message.messageId,
          bookingId: message.payload.bookingId,
          eventId: message.payload.eventId,
          reason: result.reason
        },
        "Unable to confirm booking"
      );
      return;
    }

    await this.outboxDispatcher.dispatchPending();
    this.logger.info(
      {
        messageId: message.messageId,
        bookingId: result.booking.id,
        eventId: result.booking.eventId
      },
      "Booking confirmed message queued"
    );
  }

  async handleSeatReservationFailed(message: MessageEnvelope<SeatReservationFailedPayload>): Promise<void> {
    const failedMessage: MessageEnvelope<BookingFailedPayload> = {
      messageId: randomUUID(),
      correlationId: message.correlationId,
      timestamp: new Date().toISOString(),
      version: 1,
      payload: {
        bookingId: message.payload.bookingId,
        eventId: message.payload.eventId,
        reason: message.payload.reason
      }
    };

    const result = await this.repository.processSeatReservationFailedMessage({
      messageId: message.messageId,
      bookingId: message.payload.bookingId,
      eventId: message.payload.eventId,
      reason: message.payload.reason,
      outboxOnFailure: {
        id: randomUUID(),
        topic: Topics.BOOKING_FAILED,
        message: failedMessage
      }
    });

    if (result.duplicate) {
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

    if (!result.failed) {
      this.logger.warn(
        {
          messageId: message.messageId,
          bookingId: message.payload.bookingId,
          eventId: message.payload.eventId,
          reason: result.reason
        },
        "Unable to fail booking"
      );
      return;
    }

    await this.outboxDispatcher.dispatchPending();
    this.logger.warn(
      {
        messageId: message.messageId,
        bookingId: result.booking.id,
        eventId: result.booking.eventId,
        reason: message.payload.reason
      },
      "Booking failed message queued"
    );
  }
}
