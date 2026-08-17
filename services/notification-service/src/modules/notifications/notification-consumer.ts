import {
  type BookingCancelledPayload,
  type BookingFailedPayload,
  type BookingConfirmedPayload,
  type MessageEnvelope,
  Topics
} from "@event-booking/contracts";
import { createLogger, type AppLogger } from "@event-booking/logger";
import type { NotificationSink, NotificationRecord } from "../../infrastructure/notifications/notification-sink";
import { observeDomain } from "@event-booking/observability";

class NotificationConsumer {
  constructor(
    private readonly sink: NotificationSink,
    private readonly logger: AppLogger = createLogger("notification-service")
  ) {}

  list(pagination?: { page: number; pageSize: number }): Promise<NotificationRecord[]> {
    return this.sink.list(pagination);
  }

  async handleBookingConfirmed(message: MessageEnvelope<BookingConfirmedPayload>): Promise<void> {
    const stored = await this.sink.appendIfUnprocessed({
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
    if (!stored) {
      this.logger.info(
        {
          messageId: message.messageId,
          bookingId: message.payload.bookingId,
          eventId: message.payload.eventId
        },
        "Skipping duplicate booking confirmed message"
      );
      return;
    }

    observeDomain("notification-service", "notification_stored", "booking_confirmed");
    this.logger.info(
      {
        messageId: message.messageId,
        bookingId: message.payload.bookingId,
        eventId: message.payload.eventId
      },
      "Stored booking confirmed notification"
    );
  }

  async handleBookingFailed(message: MessageEnvelope<BookingFailedPayload>): Promise<void> {
    const stored = await this.sink.appendIfUnprocessed({
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
    if (!stored) {
      this.logger.info(
        {
          messageId: message.messageId,
          bookingId: message.payload.bookingId,
          eventId: message.payload.eventId
        },
        "Skipping duplicate booking failed message"
      );
      return;
    }

    observeDomain("notification-service", "notification_stored", "booking_failed");
    this.logger.warn(
      {
        messageId: message.messageId,
        bookingId: message.payload.bookingId,
        eventId: message.payload.eventId,
        reason: message.payload.reason
      },
      "Stored booking failed notification"
    );
  }

  async handleBookingCancelled(message: MessageEnvelope<BookingCancelledPayload>): Promise<void> {
    const stored = await this.sink.appendIfUnprocessed({
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
    if (!stored) {
      this.logger.info(
        {
          messageId: message.messageId,
          bookingId: message.payload.bookingId,
          eventId: message.payload.eventId
        },
        "Skipping duplicate booking cancelled message"
      );
      return;
    }

    observeDomain("notification-service", "notification_stored", "booking_cancelled");
    this.logger.info(
      {
        messageId: message.messageId,
        bookingId: message.payload.bookingId,
        eventId: message.payload.eventId
      },
      "Stored booking cancelled notification"
    );
  }
}

export function createNotificationConsumer(sink: NotificationSink) {
  return new NotificationConsumer(sink);
}

export { Topics };
