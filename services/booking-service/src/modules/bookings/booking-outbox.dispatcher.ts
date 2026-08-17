import type { MessageEnvelope, Topic } from "@event-booking/contracts";
import { createLogger, type AppLogger } from "@event-booking/logger";
import type { BookingOutboxRecord, BookingRepository } from "./booking.types";
import type { MessagePublisher } from "../../infrastructure/messaging/message-publisher";
import { randomUUID } from "crypto";
import { observeDomain } from "@event-booking/observability";

function toEnvelope<TPayload>(record: BookingOutboxRecord): MessageEnvelope<TPayload> {
  return record.message as MessageEnvelope<TPayload>;
}

export class BookingOutboxDispatcher {
  private interval: NodeJS.Timeout | null = null;
  private draining = false;
  private readonly workerId = randomUUID();

  constructor(
    private readonly repository: BookingRepository,
    private readonly publisher: MessagePublisher,
    private readonly logger: AppLogger = createLogger("booking-service")
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
      const pending = await this.repository.claimOutboxMessages({
        workerId: this.workerId,
        limit,
        claimTimeoutSeconds: 60,
        maxAttempts: 8
      });
      for (const record of pending) {
        await this.publishRecord(record);
      }
    } finally {
      this.draining = false;
    }
  }

  private async publishRecord(record: BookingOutboxRecord): Promise<void> {
    try {
      await this.publisher.publish(record.topic as Topic, toEnvelope(record));
      await this.repository.markOutboxPublished(record.id, this.workerId);
      observeDomain("booking-service", "outbox_publish", "success");
      this.logger.info(
        {
          outboxId: record.id,
          topic: record.topic,
          messageId: record.messageId,
          attempts: record.attempts
        },
        "Outbox event published"
      );
    } catch (error) {
      observeDomain("booking-service", "outbox_publish", "failure");
      const message = error instanceof Error ? error.message : "Outbox publish failed";
      this.logger.error(
        {
          outboxId: record.id,
          topic: record.topic,
          messageId: record.messageId,
          attempts: record.attempts,
          error: message
        },
        "Outbox publish failed"
      );
      try {
        const backoffSeconds = Math.min(300, 2 ** Math.max(0, record.attempts - 1));
        await this.repository.recordOutboxFailure(record.id, this.workerId, message, 8, backoffSeconds);
      } catch {
        // Keep the row available for the next retry even if bookkeeping fails.
      }
    }
  }
}
