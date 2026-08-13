import type { Prisma, Booking as BookingModel, PrismaClient } from "@prisma/client";
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

export type BookingDatabaseClient = {
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
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
};

export interface BookingRepository {
  create(input: {
    id: string;
    userId: string;
    eventId: string;
    quantity: number;
    status: BookingStatus;
    idempotencyKey: string | null;
  }): Promise<BookingDto>;
  findById(id: string): Promise<BookingDto | null>;
  findByUserId(userId: string): Promise<BookingDto[]>;
  findByIdempotencyKey(key: string): Promise<BookingDto | null>;
  updateStatus(id: string, status: BookingStatus): Promise<BookingDto | null>;
  storeIdempotencyKey(input: {
    key: string;
    bookingId: string;
    response: unknown;
  }): Promise<void>;
  findIdempotencyResponse(key: string): Promise<unknown | null>;
  hasProcessedMessage(messageId: string): Promise<boolean>;
  markMessageProcessed(messageId: string): Promise<void>;
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
}
