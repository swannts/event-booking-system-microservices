import type { NotificationRecord, NotificationSink } from "./notification-sink";

export class InMemoryNotificationStore implements NotificationSink {
  private readonly records: NotificationRecord[] = [];
  private readonly processed = new Set<string>();

  async append(record: NotificationRecord): Promise<void> {
    this.records.push(record);
  }

  list(): NotificationRecord[] {
    return [...this.records];
  }

  async hasProcessedMessage(messageId: string): Promise<boolean> {
    return this.processed.has(messageId);
  }

  async markProcessed(messageId: string): Promise<void> {
    this.processed.add(messageId);
  }
}
