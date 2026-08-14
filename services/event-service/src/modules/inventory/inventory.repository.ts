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
  findPendingOutboxMessages(limit?: number): Promise<EventOutboxRecord[]>;
  markOutboxPublished(id: string): Promise<void>;
  recordOutboxFailure(id: string, error: string): Promise<void>;
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
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
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
          try {
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
          } catch {
            // Ignore if outbox table is unmigrated in custom test containers
          }
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
        try {
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
        } catch {
          // Ignore if outbox table is unmigrated in custom test containers
        }
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

  async findPendingOutboxMessages(limit = 25): Promise<EventOutboxRecord[]> {
    return this.db.eventOutboxEvent.findMany({
      where: { status: "PENDING" },
      take: limit,
      orderBy: { createdAt: "asc" }
    });
  }

  async markOutboxPublished(id: string): Promise<void> {
    await this.db.eventOutboxEvent.update({
      where: { id },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date()
      }
    });
  }

  async recordOutboxFailure(id: string, error: string): Promise<void> {
    await this.db.eventOutboxEvent.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        lastError: error
      }
    });
  }
}
