import { Prisma } from "../../../generated/prisma";
import type { EventDto, EventRecord } from "../events/event.repository";

type PrimitiveTransactionClient = {
  event: {
    findUnique(input: { where: { id: string } }): Promise<EventRecord | null>;
    create(input: {
      data: { id: string; title: string; date: Date; totalSeats: number; availableSeats: number };
    }): Promise<EventRecord>;
    updateMany(input: {
      where: { id: string; availableSeats?: { gte: number } };
      data: {
        availableSeats?: { decrement?: number; increment?: number };
        updatedAt?: Date;
      };
    }): Promise<{ count: number }>;
  };
  processedEventMessage: {
    create(input: { data: { messageId: string } }): Promise<{ messageId: string }>;
    findUnique(input: { where: { messageId: string } }): Promise<{ messageId: string } | null>;
  };
  $queryRaw<T>(query: TemplateStringsArray | ReturnType<typeof Prisma.sql>): Promise<T>;
};

export type InventoryDatabaseClient = PrimitiveTransactionClient & {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $transaction<T>(fn: (tx: PrimitiveTransactionClient) => Promise<T>): Promise<T>;
};

export type ReleaseSeatsResult =
  | { duplicate: true; released: false; reason: "DUPLICATE_MESSAGE" }
  | { duplicate: false; released: true; event: EventDto }
  | {
      duplicate: false;
      released: false;
      reason: "INVALID_QUANTITY" | "EVENT_NOT_FOUND" | "CAPACITY_EXCEEDED";
    };

export interface InventoryRepository {
  reserveSeats(eventId: string, quantity: number): Promise<EventDto | null>;
  releaseSeats(eventId: string, quantity: number): Promise<EventDto | null>;
  hasProcessedMessage(messageId: string): Promise<boolean>;
  markMessageProcessed(messageId: string): Promise<void>;
  processReleaseSeatsMessage(input: {
    messageId: string;
    eventId: string;
    quantity: number;
  }): Promise<ReleaseSeatsResult>;
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
}
