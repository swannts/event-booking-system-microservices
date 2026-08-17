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
  appendIfUnprocessed(record: NotificationRecord): Promise<boolean>;
  list(pagination?: { page: number; pageSize: number }): Promise<NotificationRecord[]>;
}
