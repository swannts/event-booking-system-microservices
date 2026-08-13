import { randomUUID } from "crypto";
import {
  Topics,
  type BookingConfirmedPayload,
  type BookingFailedPayload,
  type MessageEnvelope,
  type SeatReservationFailedPayload,
  type SeatsReservedPayload
} from "@event-booking/contracts";
import type { MessagePublisher } from "../../infrastructure/messaging/message-publisher";
import type { BookingRepository } from "../../infrastructure/database/booking-repository";

export class BookingEventsConsumer {
  constructor(
    private readonly repository: BookingRepository,
    private readonly publisher: MessagePublisher
  ) {}

  async handleSeatsReserved(message: MessageEnvelope<SeatsReservedPayload>): Promise<void> {
    if (await this.repository.hasProcessedMessage(message.messageId)) {
      return;
    }

    const booking = await this.repository.updateStatus(message.payload.bookingId, "CONFIRMED");
    if (!booking) {
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
  }

  async handleSeatReservationFailed(message: MessageEnvelope<SeatReservationFailedPayload>): Promise<void> {
    if (await this.repository.hasProcessedMessage(message.messageId)) {
      return;
    }

    const booking = await this.repository.updateStatus(message.payload.bookingId, "FAILED");
    if (!booking) {
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
  }
}
