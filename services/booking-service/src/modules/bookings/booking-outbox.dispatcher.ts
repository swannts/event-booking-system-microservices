import type { MessageEnvelope, Topic } from "@event-booking/contracts";
import type { BookingOutboxRecord, BookingRepository } from "../../infrastructure/database/booking-repository";
import type { MessagePublisher } from "../../infrastructure/messaging/message-publisher";

function toEnvelope<TPayload>(record: BookingOutboxRecord): MessageEnvelope<TPayload> {
  return record.message as MessageEnvelope<TPayload>;
}

export class BookingOutboxDispatcher {
  private interval: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly repository: BookingRepository,
    private readonly publisher: MessagePublisher
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

  private async publishRecord(record: BookingOutboxRecord): Promise<void> {
    try {
      await this.publisher.publish(record.topic as Topic, toEnvelope(record));
      await this.repository.markOutboxPublished(record.id);
    } catch (error) {
      try {
        await this.repository.recordOutboxFailure(
          record.id,
          error instanceof Error ? error.message : "Outbox publish failed"
        );
      } catch {
        // Keep the row available for the next retry even if bookkeeping fails.
      }
    }
  }
}
