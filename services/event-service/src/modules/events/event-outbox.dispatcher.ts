import type { MessageEnvelope, Topic } from "@event-booking/contracts";
import { createLogger, type AppLogger } from "@event-booking/logger";
import type { EventOutboxRecord, InventoryRepository } from "../inventory/inventory.repository";
import type { MessagePublisher } from "../../infrastructure/messaging/message-publisher";

function toEnvelope<TPayload>(record: EventOutboxRecord): MessageEnvelope<TPayload> {
  return record.message as MessageEnvelope<TPayload>;
}

export class EventOutboxDispatcher {
  private interval: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly repository: InventoryRepository,
    private readonly publisher: MessagePublisher,
    private readonly logger: AppLogger = createLogger("event-service")
  ) {}

  start(intervalMs = 5000): void {
    if (this.interval) {
      return;
    }

    void this.dispatchPending().catch(() => undefined);
    this.interval = setInterval(() => {
      void this.dispatchPending().catch(() => undefined);
    }, intervalMs);
    this.interval.unref?.();
  }

  stop(): void {
    if (!this.interval) {
      return;
    }

    clearInterval(this.interval);
    this.interval = null;
  }

  async dispatchPending(limit = 25): Promise<void> {
    if (this.draining) {
      return;
    }

    this.draining = true;
    try {
      const pending = await this.repository.findPendingOutboxMessages(limit);
      for (const record of pending) {
        await this.publishRecord(record);
      }
    } finally {
      this.draining = false;
    }
  }

  private async publishRecord(record: EventOutboxRecord): Promise<void> {
    try {
      await this.publisher.publish(record.topic as Topic, toEnvelope(record));
      await this.repository.markOutboxPublished(record.id);
      this.logger.info(
        {
          outboxId: record.id,
          topic: record.topic,
          messageId: record.messageId,
          attempts: record.attempts
        },
        "Event outbox event published"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Event outbox publish failed";
      this.logger.error(
        {
          outboxId: record.id,
          topic: record.topic,
          messageId: record.messageId,
          attempts: record.attempts,
          error: message
        },
        "Event outbox publish failed"
      );
      try {
        await this.repository.recordOutboxFailure(record.id, message);
      } catch {
        // Keep row available for next retry if bookkeeping fails
      }
    }
  }
}
