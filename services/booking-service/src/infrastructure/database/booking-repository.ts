import type { Prisma, Booking as BookingModel, PrismaClient } from "@prisma/client";
import type { MessageEnvelope, Topic } from "@event-booking/contracts";
import type { BookingStatus } from "@event-booking/contracts";

export type BookingRecord = BookingModel;

export type BookingDto = {
  id: string;
  userId: string;
  eventId: string;
  quantity: number;
  status: BookingStatus;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BookingOutboxStatus = "PENDING" | "PUBLISHED";

export type BookingOutboxRecord = {
  id: string;
  topic: Topic;
  messageId: string;
  message: Prisma.JsonValue;
  status: BookingOutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type BookingTransactionalClient = {
  booking: {
    create(input: {
      data: {
        id: string;
        userId: string;
        eventId: string;
        quantity: number;
        status: BookingStatus;
        idempotencyKey: string | null;
      };
    }): Promise<BookingRecord>;
    findUnique(input: { where: { id?: string; idempotencyKey?: string } }): Promise<BookingRecord | null>;
    findMany(input?: {
      where?: { userId?: string };
      orderBy?: { createdAt?: "asc" | "desc" };
    }): Promise<BookingRecord[]>;
    update(input: {
      where: { id: string };
      data: Partial<{
        status: BookingStatus;
        updatedAt: Date;
      }>;
    }): Promise<BookingRecord>;
  };
  bookingIdempotencyKey: {
    findUnique(input: { where: { key: string } }): Promise<{
      key: string;
      bookingId: string;
      response: Prisma.JsonValue;
      createdAt: Date;
    } | null>;
    upsert(input: {
      where: { key: string };
      update: {
        bookingId: string;
        response: Prisma.InputJsonValue;
      };
      create: {
        key: string;
        bookingId: string;
        response: Prisma.InputJsonValue;
      };
    }): Promise<{
      key: string;
      bookingId: string;
      response: Prisma.JsonValue;
      createdAt: Date;
    }>;
    create(input: {
      data: {
        key: string;
        bookingId: string;
        response: Prisma.InputJsonValue;
      };
    }): Promise<{
      key: string;
      bookingId: string;
      response: Prisma.JsonValue;
      createdAt: Date;
    }>;
  };
  processedBookingMessage: {
    findUnique(input: { where: { messageId: string } }): Promise<{
      messageId: string;
      processedAt: Date;
    } | null>;
    upsert(input: {
      where: { messageId: string };
      update: Record<string, never>;
      create: { messageId: string };
    }): Promise<{
      messageId: string;
      processedAt: Date;
    }>;
  };
  bookingOutboxEvent: {
    create(input: {
      data: {
        id: string;
        topic: Topic;
        messageId: string;
        message: Prisma.InputJsonValue;
        status: BookingOutboxStatus;
        attempts: number;
        lastError: string | null;
        publishedAt: Date | null;
      };
    }): Promise<{
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
    }>;
    findUnique(input: { where: { id: string } }): Promise<{
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
    } | null>;
    findMany(input?: {
      where?: { status?: BookingOutboxStatus };
      orderBy?: { createdAt?: "asc" | "desc" };
      take?: number;
    }): Promise<
      Array<{
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
      }>
    >;
    update(input: {
      where: { id: string };
      data: Partial<{
        status: BookingOutboxStatus;
        attempts: number;
        lastError: string | null;
        publishedAt: Date | null;
        updatedAt: Date;
      }>;
    }): Promise<{
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
    }>;
  };
};

export type BookingDatabaseClient = PrismaClient & BookingTransactionalClient;

export interface BookingRepository {
  create(input: {
    id: string;
    userId: string;
    eventId: string;
    quantity: number;
    status: BookingStatus;
    idempotencyKey: string | null;
  }): Promise<BookingDto>;
  createBookingWithOutbox(input: {
    id: string;
    userId: string;
    eventId: string;
    quantity: number;
    status: BookingStatus;
    idempotencyKey: string | null;
  }, outbox: {
    id: string;
    topic: Topic;
    message: MessageEnvelope<unknown>;
  }): Promise<BookingDto>;
  findById(id: string): Promise<BookingDto | null>;
  findByUserId(userId: string): Promise<BookingDto[]>;
  findByIdempotencyKey(key: string): Promise<BookingDto | null>;
  updateStatus(id: string, status: BookingStatus): Promise<BookingDto | null>;
  cancelBookingWithOutbox(input: {
    id: string;
    outbox: {
      id: string;
      topic: Topic;
      message: MessageEnvelope<unknown>;
    };
  }): Promise<BookingDto | null>;
  storeIdempotencyKey(input: {
    key: string;
    bookingId: string;
    response: unknown;
  }): Promise<void>;
  findIdempotencyResponse(key: string): Promise<unknown | null>;
  hasProcessedMessage(messageId: string): Promise<boolean>;
  markMessageProcessed(messageId: string): Promise<void>;
  findPendingOutboxMessages(limit?: number): Promise<BookingOutboxRecord[]>;
  markOutboxPublished(id: string): Promise<void>;
  recordOutboxFailure(id: string, error: string): Promise<void>;
}

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
