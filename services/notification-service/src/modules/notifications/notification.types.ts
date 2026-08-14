export type NotificationRecord = {
  timestamp: string;
  service: "notification-service";
  level: "info";
  message: string;
  type: "BOOKING_CONFIRMED" | "BOOKING_FAILED" | "BOOKING_CANCELLED";
  messageId: string;
  correlationId: string;
  bookingId: string;
  eventId: string;
  reason?: string;
};

export interface NotificationSink {
  append(record: NotificationRecord): Promise<void>;
  list(): NotificationRecord[];
  hasProcessedMessage(messageId: string): Promise<boolean>;
  markProcessed(messageId: string): Promise<void>;
}
