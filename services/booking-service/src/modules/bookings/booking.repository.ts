import { Prisma } from "../../../generated/prisma";
import type { MessageEnvelope, Topic } from "@event-booking/contracts";
import type { BookingStatus } from "@event-booking/contracts";
import type {
  CancelBookingResult,
  BookingDatabaseClient,
  BookingDto,
  BookingProcessingFailureReason,
  BookingOutboxRecord,
  BookingOutboxStatus,
  BookingRecord,
  ProcessSeatReservationFailedResult,
  ProcessSeatsReservedResult,
  BookingRepository,
  BookingTransactionalClient
} from "./booking.types";
import { BookingErrors } from "./booking.errors";

export type {
  CancelBookingResult,
  BookingDatabaseClient,
  BookingDto,
  BookingProcessingFailureReason,
  BookingOutboxRecord,
  BookingOutboxStatus,
  BookingRecord,
  ProcessSeatReservationFailedResult,
  ProcessSeatsReservedResult,
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
  nextAttemptAt: Date;
  claimedAt: Date | null;
  claimedBy: string | null;
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
    nextAttemptAt: row.nextAttemptAt.toISOString(),
    claimedAt: row.claimedAt?.toISOString() ?? null,
    claimedBy: row.claimedBy,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002"
  );
}

function serializeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "Outbox publish failed";
}

function classifyBookingFailure(
  booking: BookingDto | null,
  input: {
    eventId: string;
    quantity?: number;
    status?: BookingStatus;
  }
): BookingProcessingFailureReason {
  if (!booking) {
    return "BOOKING_NOT_FOUND";
  }

  if (booking.eventId !== input.eventId) {
    return "EVENT_MISMATCH";
  }

  if (typeof input.quantity === "number" && booking.quantity !== input.quantity) {
    return "QUANTITY_MISMATCH";
  }

  if (input.status && booking.status !== input.status) {
    return "INVALID_STATUS";
  }

  return "INVALID_STATUS";
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
      requestFingerprint: string;
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
              requestFingerprint: input.requestFingerprint,
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
        const existing = await this.findIdempotencyRecord(input.idempotencyKey);
        if (existing) {
          if (existing.requestFingerprint !== input.requestFingerprint) {
            throw BookingErrors.idempotencyKeyReused();
          }
          return existing.response;
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

  async findByUserId(
    userId: string,
    { page, pageSize }: { page: number; pageSize: number } = { page: 1, pageSize: 20 }
  ): Promise<BookingDto[]> {
    const bookings = await this.db.booking.findMany({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
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
  }): Promise<CancelBookingResult> {
    return this.db.$transaction(async (tx) => {
      const transactional = tx as unknown as BookingTransactionalClient;
      const updateResult = await transactional.booking.updateMany({
        where: { id: input.id, status: "CONFIRMED" },
        data: { status: "CANCELLED", updatedAt: new Date() }
      });

      if (updateResult.count === 0) {
        const booking = await transactional.booking.findUnique({ where: { id: input.id } });
        if (!booking) {
          return { cancelled: false, reason: "BOOKING_NOT_FOUND" } as const;
        }

        return { cancelled: false, reason: "INVALID_STATUS" } as const;
      }

      const booking = await transactional.booking.findUnique({ where: { id: input.id } });
      if (!booking) {
        return { cancelled: false, reason: "BOOKING_NOT_FOUND" } as const;
      }

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

      return {
        cancelled: true,
        booking: mapRow(booking),
        outboxRowId: input.outbox.id
      } as const;
    });
  }

  async processSeatsReservedMessage(input: {
    messageId: string;
    bookingId: string;
    eventId: string;
    quantity: number;
    outboxOnSuccess: {
      id: string;
      topic: Topic;
      message: MessageEnvelope<unknown>;
    };
  }): Promise<ProcessSeatsReservedResult> {
    return this.db.$transaction(async (tx) => {
      const transactional = tx as unknown as BookingTransactionalClient;

      try {
        await transactional.processedBookingMessage.create({
          data: { messageId: input.messageId }
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return { duplicate: true, confirmed: false, reason: "DUPLICATE_MESSAGE" } as const;
        }

        throw error;
      }

      const updateResult = await transactional.booking.updateMany({
        where: {
          id: input.bookingId,
          eventId: input.eventId,
          quantity: input.quantity,
          status: "PENDING"
        },
        data: {
          status: "CONFIRMED",
          updatedAt: new Date()
        }
      });

      const booking = await transactional.booking.findUnique({ where: { id: input.bookingId } });

      if (
        updateResult.count === 0 ||
        !booking ||
        booking.eventId !== input.eventId ||
        booking.quantity !== input.quantity
      ) {
        return {
          duplicate: false,
          confirmed: false,
          reason: classifyBookingFailure(booking ? mapRow(booking) : null, {
            eventId: input.eventId,
            quantity: input.quantity,
            status: "PENDING"
          })
        } as const;
      }

      await transactional.bookingOutboxEvent.create({
        data: {
          id: input.outboxOnSuccess.id,
          topic: input.outboxOnSuccess.topic,
          messageId: input.outboxOnSuccess.message.messageId,
          message: input.outboxOnSuccess.message as Prisma.InputJsonValue,
          status: "PENDING",
          attempts: 0,
          lastError: null,
          publishedAt: null
        }
      });

      return {
        duplicate: false,
        confirmed: true,
        booking: mapRow(booking),
        outboxRowId: input.outboxOnSuccess.id
      } as const;
    });
  }

  async processSeatReservationFailedMessage(input: {
    messageId: string;
    bookingId: string;
    eventId: string;
    reason: "INSUFFICIENT_SEATS" | "EVENT_NOT_FOUND";
    outboxOnFailure: {
      id: string;
      topic: Topic;
      message: MessageEnvelope<unknown>;
    };
  }): Promise<ProcessSeatReservationFailedResult> {
    return this.db.$transaction(async (tx) => {
      const transactional = tx as unknown as BookingTransactionalClient;

      try {
        await transactional.processedBookingMessage.create({
          data: { messageId: input.messageId }
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return { duplicate: true, failed: false, reason: "DUPLICATE_MESSAGE" } as const;
        }

        throw error;
      }

      const updateResult = await transactional.booking.updateMany({
        where: {
          id: input.bookingId,
          eventId: input.eventId,
          status: "PENDING"
        },
        data: {
          status: "FAILED",
          updatedAt: new Date()
        }
      });

      const booking = await transactional.booking.findUnique({ where: { id: input.bookingId } });

      if (updateResult.count === 0 || !booking || booking.eventId !== input.eventId) {
        return {
          duplicate: false,
          failed: false,
          reason: classifyBookingFailure(booking ? mapRow(booking) : null, {
            eventId: input.eventId,
            status: "PENDING"
          })
        } as const;
      }

      await transactional.bookingOutboxEvent.create({
        data: {
          id: input.outboxOnFailure.id,
          topic: input.outboxOnFailure.topic,
          messageId: input.outboxOnFailure.message.messageId,
          message: input.outboxOnFailure.message as Prisma.InputJsonValue,
          status: "PENDING",
          attempts: 0,
          lastError: null,
          publishedAt: null
        }
      });

      return {
        duplicate: false,
        failed: true,
        booking: mapRow(booking),
        outboxRowId: input.outboxOnFailure.id
      } as const;
    });
  }

  async storeIdempotencyKey(input: {
    key: string;
    bookingId: string;
    requestFingerprint: string;
    response: unknown;
  }): Promise<void> {
    await this.db.bookingIdempotencyKey.upsert({
      where: { key: input.key },
      update: {
        bookingId: input.bookingId,
        requestFingerprint: input.requestFingerprint,
        response: input.response as Prisma.InputJsonValue
      },
      create: {
        key: input.key,
        bookingId: input.bookingId,
        requestFingerprint: input.requestFingerprint,
        response: input.response as Prisma.InputJsonValue
      }
    });
  }

  async findIdempotencyResponse(key: string): Promise<unknown | null> {
    const record = await this.db.bookingIdempotencyKey.findUnique({ where: { key } });
    return record?.response ?? null;
  }

  async findIdempotencyRecord(key: string): Promise<{ requestFingerprint: string; response: BookingDto } | null> {
    const record = await this.db.bookingIdempotencyKey.findUnique({ where: { key } });
    if (!record) {
      return null;
    }

    return {
      requestFingerprint: record.requestFingerprint,
      response: record.response as unknown as BookingDto
    };
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

  async claimOutboxMessages(input: {
    workerId: string;
    limit: number;
    claimTimeoutSeconds: number;
    maxAttempts: number;
  }): Promise<BookingOutboxRecord[]> {
    const events = await this.db.$queryRaw<
      Array<{
        id: string;
        topic: string;
        messageId: string;
        message: Prisma.JsonValue;
        status: BookingOutboxStatus;
        attempts: number;
        nextAttemptAt: Date;
        claimedAt: Date | null;
        claimedBy: string | null;
        lastError: string | null;
        createdAt: Date;
        updatedAt: Date;
        publishedAt: Date | null;
      }>
    >(Prisma.sql`
      WITH claimable AS (
        SELECT id
        FROM booking_outbox_events
        WHERE attempts < ${input.maxAttempts}
          AND (
            (status = 'PENDING' AND next_attempt_at <= NOW())
            OR (status = 'PROCESSING' AND claimed_at < NOW() - (${input.claimTimeoutSeconds} * INTERVAL '1 second'))
          )
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${input.limit}
      )
      UPDATE booking_outbox_events AS outbox
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

    return events.map(mapOutboxRow);
  }

  async markOutboxPublished(id: string, workerId?: string): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE booking_outbox_events
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
      UPDATE booking_outbox_events
      SET status = CASE WHEN attempts >= ${maxAttempts} THEN 'FAILED'::"OutboxStatus" ELSE 'PENDING'::"OutboxStatus" END,
          next_attempt_at = NOW() + (${backoffSeconds} * INTERVAL '1 second'),
          claimed_at = NULL,
          claimed_by = NULL,
          last_error = ${serializeError(error)},
          updated_at = NOW()
      WHERE id = ${id}::uuid
        AND status = 'PROCESSING'
        AND claimed_by = ${workerId}
    `);
  }
}
