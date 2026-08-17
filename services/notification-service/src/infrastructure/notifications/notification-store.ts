import type { NotificationRecord, NotificationSink } from "./notification-sink";

export class InMemoryNotificationStore implements NotificationSink {
  private readonly records: NotificationRecord[] = [];
  private readonly processed = new Set<string>();

  async appendIfUnprocessed(record: NotificationRecord): Promise<boolean> {
    if (this.processed.has(record.messageId)) {
      return false;
    }
    this.records.push(record);
    this.processed.add(record.messageId);
    return true;
  }

  async list(
    { page = 1, pageSize = 20 }: { page: number; pageSize: number } = { page: 1, pageSize: 20 }
  ): Promise<NotificationRecord[]> {
    return this.records.slice((page - 1) * pageSize, page * pageSize);
  }
}
