import {
  type BookingCancelledPayload,
  type BookingFailedPayload,
  type BookingConfirmedPayload,
  type MessageEnvelope,
  Topics
} from "@event-booking/contracts";
import type { NotificationSink, NotificationRecord } from "../../infrastructure/notifications/notification-sink";

class NotificationConsumer {
  constructor(private readonly sink: NotificationSink) {}

  list(): NotificationRecord[] {
    return this.sink.list();
  }

  async handleBookingConfirmed(message: MessageEnvelope<BookingConfirmedPayload>): Promise<void> {
    if (await this.sink.hasProcessedMessage(message.messageId)) {
      return;
    }

    await this.sink.append({
      timestamp: new Date().toISOString(),
      service: "notification-service",
      level: "info",
      message: "Booking confirmed",
      type: "BOOKING_CONFIRMED",
      messageId: message.messageId,
      correlationId: message.correlationId,
      bookingId: message.payload.bookingId,
      eventId: message.payload.eventId
    });

    await this.sink.markProcessed(message.messageId);
  }

  async handleBookingFailed(message: MessageEnvelope<BookingFailedPayload>): Promise<void> {
    if (await this.sink.hasProcessedMessage(message.messageId)) {
      return;
    }

    await this.sink.append({
      timestamp: new Date().toISOString(),
      service: "notification-service",
      level: "info",
      message: "Booking failed",
      type: "BOOKING_FAILED",
      messageId: message.messageId,
      correlationId: message.correlationId,
      bookingId: message.payload.bookingId,
      eventId: message.payload.eventId,
      reason: message.payload.reason
    });

    await this.sink.markProcessed(message.messageId);
  }

  async handleBookingCancelled(message: MessageEnvelope<BookingCancelledPayload>): Promise<void> {
    if (await this.sink.hasProcessedMessage(message.messageId)) {
      return;
    }

    await this.sink.append({
      timestamp: new Date().toISOString(),
      service: "notification-service",
      level: "info",
      message: "Booking cancelled",
      type: "BOOKING_CANCELLED",
      messageId: message.messageId,
      correlationId: message.correlationId,
      bookingId: message.payload.bookingId,
      eventId: message.payload.eventId
    });

    await this.sink.markProcessed(message.messageId);
  }
}

export function createNotificationConsumer(sink: NotificationSink) {
  return new NotificationConsumer(sink);
}

export { Topics };
