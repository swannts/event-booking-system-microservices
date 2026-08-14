export type NotificationItem = {
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

export class NotificationClientDriver {
  constructor(private readonly baseUrl = "http://127.0.0.1:3003") {}

  async listNotifications(): Promise<NotificationItem[]> {
    const res = await fetch(`${this.baseUrl}/notifications`);
    if (!res.ok) {
      throw new Error(`Failed to list notifications (${res.status})`);
    }
    return await res.json();
  }
}
