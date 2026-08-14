export type NotificationItem = {
  id: string;
  type: string;
  recipientId?: string;
  message: string;
  messageId: string;
  reason?: string;
  payload: Record<string, unknown>;
  createdAt: string;
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
