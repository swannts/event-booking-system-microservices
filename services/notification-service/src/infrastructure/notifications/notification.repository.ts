import { randomUUID } from "crypto";
import type { NotificationDatabase } from "../../config/database";
import type { NotificationRecord, NotificationSink } from "../../modules/notifications/notification.types";

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002");
}

export class PrismaNotificationRepository implements NotificationSink {
  constructor(private readonly db: NotificationDatabase) {}

  async appendIfUnprocessed(record: NotificationRecord): Promise<boolean> {
    try {
      await this.db.$transaction(async (tx) => {
        await tx.processedNotificationMessage.create({ data: { messageId: record.messageId } });
        await tx.notification.create({
          data: {
            id: randomUUID(),
            type: record.type,
            messageId: record.messageId,
            correlationId: record.correlationId,
            bookingId: record.bookingId,
            eventId: record.eventId,
            message: record.message,
            reason: record.reason,
            occurredAt: new Date(record.timestamp)
          }
        });
      });
      return true;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return false;
      }
      throw error;
    }
  }

  async list(): Promise<NotificationRecord[]> {
    const rows = await this.db.notification.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map((row) => ({
      timestamp: row.occurredAt.toISOString(),
      service: "notification-service",
      level: "info",
      message: row.message,
      type: row.type,
      messageId: row.messageId,
      correlationId: row.correlationId,
      bookingId: row.bookingId,
      eventId: row.eventId,
      ...(row.reason ? { reason: row.reason } : {})
    }));
  }
}
