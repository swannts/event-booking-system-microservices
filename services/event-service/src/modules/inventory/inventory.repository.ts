import { Prisma } from "../../../generated/prisma";
import type { EventDto, EventRecord } from "../events/event.repository";
import type {
  EventOutboxRecord,
  InventoryDatabaseClient,
  ProcessReleaseSeatsInput,
  ProcessReserveSeatsInput,
  ReleaseSeatsResult,
  ReserveSeatsResult
} from "./inventory.types";

export type {
  EventOutboxRecord,
  InventoryDatabaseClient,
  ProcessReleaseSeatsInput,
  ProcessReserveSeatsInput,
  ReleaseSeatsResult,
  ReserveSeatsResult
};

export interface InventoryRepository {
  reserveSeats(eventId: string, quantity: number): Promise<EventDto | null>;
  releaseSeats(eventId: string, quantity: number): Promise<EventDto | null>;
  hasProcessedMessage(messageId: string): Promise<boolean>;
  markMessageProcessed(messageId: string): Promise<void>;
  processReserveSeatsMessage(input: ProcessReserveSeatsInput): Promise<ReserveSeatsResult>;
  processReleaseSeatsMessage(input: ProcessReleaseSeatsInput): Promise<ReleaseSeatsResult>;
  claimOutboxMessages(input: {
    workerId: string;
    limit: number;
    claimTimeoutSeconds: number;
    maxAttempts: number;
  }): Promise<EventOutboxRecord[]>;
  markOutboxPublished(id: string, workerId?: string): Promise<void>;
  recordOutboxFailure(
    id: string,
    workerId: string,
    error: string,
    maxAttempts: number,
    backoffSeconds: number
  ): Promise<void>;
}

function mapRow(row: EventRecord): EventDto {
  return {
    id: row.id,
    title: row.title,
    date: row.date.toISOString(),
    totalSeats: row.totalSeats,
    availableSeats: row.availableSeats,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002"
  );
}

export class PrismaInventoryRepository implements InventoryRepository {
  constructor(private readonly db: InventoryDatabaseClient) {}

  async reserveSeats(eventId: string, quantity: number): Promise<EventDto | null> {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return null;
    }

    const rows = await this.db.$queryRaw<EventRecord[]>(Prisma.sql`
      UPDATE events
      SET available_seats = available_seats - ${quantity},
          updated_at = NOW()
      WHERE id = ${eventId}::uuid
        AND available_seats >= ${quantity}
      RETURNING
        id,
        title,
        date,
        total_seats AS "totalSeats",
        available_seats AS "availableSeats",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `);

    return rows[0] ? mapRow(rows[0]) : null;
  }

  async releaseSeats(eventId: string, quantity: number): Promise<EventDto | null> {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return null;
    }

    const rows = await this.db.$queryRaw<EventRecord[]>(Prisma.sql`
      UPDATE events
      SET available_seats = available_seats + ${quantity},
          updated_at = NOW()
      WHERE id = ${eventId}::uuid
        AND available_seats + ${quantity} <= total_seats
      RETURNING
        id,
        title,
        date,
        total_seats AS "totalSeats",
        available_seats AS "availableSeats",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `);

    return rows[0] ? mapRow(rows[0]) : null;
  }

  async hasProcessedMessage(messageId: string): Promise<boolean> {
    const message = await this.db.processedEventMessage.findUnique({ where: { messageId } });
    return message !== null;
  }

  async markMessageProcessed(messageId: string): Promise<void> {
    try {
      await this.db.processedEventMessage.create({
        data: { messageId }
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
    }
  }

  async processReserveSeatsMessage(input: ProcessReserveSeatsInput): Promise<ReserveSeatsResult> {
    return this.db.$transaction(async (tx) => {
      try {
        await tx.processedEventMessage.create({
          data: { messageId: input.messageId }
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return {
            duplicate: true,
            reserved: false,
            reason: "DUPLICATE_MESSAGE"
          } as const;
        }

        throw error;
      }

      if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
        return {
          duplicate: false,
          reserved: false,
          reason: "INVALID_QUANTITY"
        } as const;
      }

      const rows = await tx.$queryRaw<EventRecord[]>(Prisma.sql`
        UPDATE events
        SET available_seats = available_seats - ${input.quantity},
            updated_at = NOW()
        WHERE id = ${input.eventId}::uuid
          AND available_seats >= ${input.quantity}
        RETURNING
          id,
          title,
          date,
          total_seats AS "totalSeats",
          available_seats AS "availableSeats",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `);

      if (rows[0]) {
        let outboxRowId: string | undefined;
        if (input.outboxOnSuccess) {
          const outboxRow = await tx.eventOutboxEvent.create({
            data: {
              id: input.outboxOnSuccess.id,
              topic: input.outboxOnSuccess.topic,
              messageId: input.outboxOnSuccess.messageId,
              message: input.outboxOnSuccess.message as Prisma.InputJsonValue,
              status: "PENDING"
            }
          });
          outboxRowId = outboxRow.id;
        }

        return {
          duplicate: false,
          reserved: true,
          event: mapRow(rows[0]),
          outboxRowId
        } as const;
      }

      const event = await tx.event.findUnique({ where: { id: input.eventId } });
      const failureReason = event ? "INSUFFICIENT_SEATS" : "EVENT_NOT_FOUND";
      let outboxRowId: string | undefined;

      if (input.outboxOnFailure) {
        const outboxMessage = {
          messageId: input.outboxOnFailure.messageId,
          correlationId: input.outboxOnFailure.correlationId,
          timestamp: new Date().toISOString(),
          version: 1,
          payload: {
            bookingId: input.outboxOnFailure.bookingId,
            eventId: input.eventId,
            reason: failureReason
          }
        };

        const outboxRow = await tx.eventOutboxEvent.create({
          data: {
            id: input.outboxOnFailure.id,
            topic: input.outboxOnFailure.topic,
            messageId: input.outboxOnFailure.messageId,
            message: outboxMessage as Prisma.InputJsonValue,
            status: "PENDING"
          }
        });
        outboxRowId = outboxRow.id;
      }

      return {
        duplicate: false,
        reserved: false,
        reason: failureReason,
        outboxRowId
      } as const;
    });
  }

  async processReleaseSeatsMessage(input: {
    messageId: string;
    eventId: string;
    quantity: number;
  }): Promise<ReleaseSeatsResult> {
    return this.db.$transaction(async (tx) => {
      try {
        await tx.processedEventMessage.create({
          data: { messageId: input.messageId }
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return {
            duplicate: true,
            released: false,
            reason: "DUPLICATE_MESSAGE"
          } as const;
        }

        throw error;
      }

      if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
        return {
          duplicate: false,
          released: false,
          reason: "INVALID_QUANTITY"
        } as const;
      }

      const rows = await tx.$queryRaw<EventRecord[]>(Prisma.sql`
        UPDATE events
        SET available_seats = available_seats + ${input.quantity},
            updated_at = NOW()
        WHERE id = ${input.eventId}::uuid
          AND available_seats + ${input.quantity} <= total_seats
        RETURNING
          id,
          title,
          date,
          total_seats AS "totalSeats",
          available_seats AS "availableSeats",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `);

      if (rows[0]) {
        return {
          duplicate: false,
          released: true,
          event: mapRow(rows[0])
        } as const;
      }

      const event = await tx.event.findUnique({ where: { id: input.eventId } });
      return {
        duplicate: false,
        released: false,
        reason: event ? "CAPACITY_EXCEEDED" : "EVENT_NOT_FOUND"
      } as const;
    });
  }

  async claimOutboxMessages(input: {
    workerId: string;
    limit: number;
    claimTimeoutSeconds: number;
    maxAttempts: number;
  }): Promise<EventOutboxRecord[]> {
    return this.db.$queryRaw<EventOutboxRecord[]>(Prisma.sql`
      WITH claimable AS (
        SELECT id
        FROM event_outbox_events
        WHERE attempts < ${input.maxAttempts}
          AND (
            (status = 'PENDING' AND next_attempt_at <= NOW())
            OR (status = 'PROCESSING' AND claimed_at < NOW() - (${input.claimTimeoutSeconds} * INTERVAL '1 second'))
          )
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${input.limit}
      )
      UPDATE event_outbox_events AS outbox
      SET status = 'PROCESSING',
          attempts = outbox.attempts + 1,
          claimed_at = NOW(),
          claimed_by = ${input.workerId},
          last_error = NULL,
          updated_at = NOW()
      FROM claimable
      WHERE outbox.id = claimable.id
      RETURNING
        outbox.id,
        outbox.topic,
        outbox.message_id AS "messageId",
        outbox.message,
        outbox.status,
        outbox.attempts,
        outbox.next_attempt_at AS "nextAttemptAt",
        outbox.claimed_at AS "claimedAt",
        outbox.claimed_by AS "claimedBy",
        outbox.last_error AS "lastError",
        outbox.created_at AS "createdAt",
        outbox.updated_at AS "updatedAt",
        outbox.published_at AS "publishedAt"
    `);
  }

  async markOutboxPublished(id: string, workerId?: string): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE event_outbox_events
      SET status = 'PUBLISHED',
          published_at = NOW(),
          claimed_at = NULL,
          claimed_by = NULL,
          last_error = NULL,
          updated_at = NOW()
      WHERE id = ${id}::uuid
        AND (${workerId ?? null}::text IS NULL OR claimed_by = ${workerId ?? null})
    `);
  }

  async recordOutboxFailure(
    id: string,
    workerId: string,
    error: string,
    maxAttempts: number,
    backoffSeconds: number
  ): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE event_outbox_events
      SET status = CASE WHEN attempts >= ${maxAttempts} THEN 'FAILED'::"OutboxStatus" ELSE 'PENDING'::"OutboxStatus" END,
          next_attempt_at = NOW() + (${backoffSeconds} * INTERVAL '1 second'),
          claimed_at = NULL,
          claimed_by = NULL,
          last_error = ${error},
          updated_at = NOW()
      WHERE id = ${id}::uuid
        AND status = 'PROCESSING'
        AND claimed_by = ${workerId}
    `);
  }
}
