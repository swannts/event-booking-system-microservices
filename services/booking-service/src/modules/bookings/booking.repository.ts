import type { Prisma, PrismaClient } from "../../../generated/prisma";
import type { MessageEnvelope, Topic } from "@event-booking/contracts";
import type { BookingStatus } from "@event-booking/contracts";
import type {
  BookingDatabaseClient,
  BookingDto,
  BookingOutboxRecord,
  BookingOutboxStatus,
  BookingRecord,
  BookingRepository,
  BookingTransactionalClient
} from "./booking.types";

export type {
  BookingDatabaseClient,
  BookingDto,
  BookingOutboxRecord,
  BookingOutboxStatus,
  BookingRecord,
  BookingRepository,
  BookingTransactionalClient
};

function mapRow(row: BookingRecord): BookingDto {
  return {
    id: row.id,
    userId: row.userId,
    eventId: row.eventId,
    quantity: row.quantity,
    status: row.status,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function mapOutboxRow(row: {
  id: string;
  topic: string;
  messageId: string;
  message: Prisma.JsonValue;
  status: BookingOutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}): BookingOutboxRecord {
  return {
    id: row.id,
    topic: row.topic as Topic,
    messageId: row.messageId,
    message: row.message,
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002");
}

function serializeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "Outbox publish failed";
}

export class PrismaBookingRepository implements BookingRepository {
  constructor(private readonly db: BookingDatabaseClient) {}

  async create(input: {
    id: string;
    userId: string;
    eventId: string;
    quantity: number;
    status: BookingStatus;
    idempotencyKey: string | null;
  }): Promise<BookingDto> {
    const booking = await this.db.booking.create({
      data: {
        id: input.id,
        userId: input.userId,
        eventId: input.eventId,
        quantity: input.quantity,
        status: input.status,
        idempotencyKey: input.idempotencyKey
      }
    });

    return mapRow(booking);
  }

  async createBookingWithOutbox(
    input: {
      id: string;
      userId: string;
      eventId: string;
      quantity: number;
      status: BookingStatus;
      idempotencyKey: string | null;
    },
    outbox: {
      id: string;
      topic: Topic;
      message: MessageEnvelope<unknown>;
    }
  ): Promise<BookingDto> {
    try {
      return await this.db.$transaction(async (tx) => {
        const transactional = tx as unknown as BookingTransactionalClient;
        const booking = await transactional.booking.create({
          data: {
            id: input.id,
            userId: input.userId,
            eventId: input.eventId,
            quantity: input.quantity,
            status: input.status,
            idempotencyKey: input.idempotencyKey
          }
        });

        if (input.idempotencyKey) {
          await transactional.bookingIdempotencyKey.create({
            data: {
              key: input.idempotencyKey,
              bookingId: booking.id,
              response: mapRow(booking)
            }
          });
        }

        await transactional.bookingOutboxEvent.create({
          data: {
            id: outbox.id,
            topic: outbox.topic,
            messageId: outbox.message.messageId,
            message: outbox.message as Prisma.InputJsonValue,
            status: "PENDING",
            attempts: 0,
            lastError: null,
            publishedAt: null
          }
        });

        return mapRow(booking);
      });
    } catch (error) {
      if (isUniqueConstraintError(error) && input.idempotencyKey) {
        const existing = await this.findIdempotencyResponse(input.idempotencyKey);
        if (existing && typeof existing === "object" && existing !== null && "id" in existing) {
          return existing as BookingDto;
        }

        const booking = await this.findByIdempotencyKey(input.idempotencyKey);
        if (booking) {
          return booking;
        }
      }

      throw error;
    }
  }

  async findById(id: string): Promise<BookingDto | null> {
    const booking = await this.db.booking.findUnique({ where: { id } });
    return booking ? mapRow(booking) : null;
  }

  async findByUserId(userId: string): Promise<BookingDto[]> {
    const bookings = await this.db.booking.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" }
    });

    return bookings.map(mapRow);
  }

  async findByIdempotencyKey(key: string): Promise<BookingDto | null> {
    const booking = await this.db.booking.findUnique({ where: { idempotencyKey: key } });
    return booking ? mapRow(booking) : null;
  }

  async updateStatus(id: string, status: BookingStatus): Promise<BookingDto | null> {
    try {
      const booking = await this.db.booking.update({
        where: { id },
        data: {
          status
        }
      });

      return mapRow(booking);
    } catch {
      return null;
    }
  }

  async cancelBookingWithOutbox(input: {
    id: string;
    outbox: {
      id: string;
      topic: Topic;
      message: MessageEnvelope<unknown>;
    };
  }): Promise<BookingDto | null> {
    try {
      return await this.db.$transaction(async (tx) => {
        const transactional = tx as unknown as BookingTransactionalClient;
        const booking = await transactional.booking.update({
          where: { id: input.id },
          data: {
            status: "CANCELLED"
          }
        });

        await transactional.bookingOutboxEvent.create({
          data: {
            id: input.outbox.id,
            topic: input.outbox.topic,
            messageId: input.outbox.message.messageId,
            message: input.outbox.message as Prisma.InputJsonValue,
            status: "PENDING",
            attempts: 0,
            lastError: null,
            publishedAt: null
          }
        });

        return mapRow(booking);
      });
    } catch {
      return null;
    }
  }

  async storeIdempotencyKey(input: {
    key: string;
    bookingId: string;
    response: unknown;
  }): Promise<void> {
    await this.db.bookingIdempotencyKey.upsert({
      where: { key: input.key },
      update: {
        bookingId: input.bookingId,
        response: input.response as Prisma.InputJsonValue
      },
      create: {
        key: input.key,
        bookingId: input.bookingId,
        response: input.response as Prisma.InputJsonValue
      }
    });
  }

  async findIdempotencyResponse(key: string): Promise<unknown | null> {
    const record = await this.db.bookingIdempotencyKey.findUnique({ where: { key } });
    return record?.response ?? null;
  }

  async hasProcessedMessage(messageId: string): Promise<boolean> {
    const record = await this.db.processedBookingMessage.findUnique({ where: { messageId } });
    return record !== null;
  }

  async markMessageProcessed(messageId: string): Promise<void> {
    await this.db.processedBookingMessage.upsert({
      where: { messageId },
      update: {},
      create: { messageId }
    });
  }

  async findPendingOutboxMessages(limit = 25): Promise<BookingOutboxRecord[]> {
    const events = await this.db.bookingOutboxEvent.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: limit
    });

    return events.map(mapOutboxRow);
  }

  async markOutboxPublished(id: string): Promise<void> {
    await this.db.bookingOutboxEvent.update({
      where: { id },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        lastError: null
      }
    });
  }

  async recordOutboxFailure(id: string, error: string): Promise<void> {
    const existing = await this.db.bookingOutboxEvent.findUnique({ where: { id } });
    if (!existing) {
      return;
    }

    await this.db.bookingOutboxEvent.update({
      where: { id },
      data: {
        attempts: existing.attempts + 1,
        lastError: serializeError(error),
        status: "PENDING"
      }
    });
  }
}
