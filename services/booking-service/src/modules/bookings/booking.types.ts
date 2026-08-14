import type { Prisma, PrismaClient } from "../../../generated/prisma";
import type { BookingStatus, MessageEnvelope, Topic } from "@event-booking/contracts";
import type { MessagePublisher } from "../../infrastructure/messaging/message-publisher";

export type BookingPublisher = MessagePublisher;

export type BookingRecord = {
  id: string;
  userId: string;
  eventId: string;
  quantity: number;
  status: BookingStatus;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

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

export type BookingProcessingFailureReason =
  | "BOOKING_NOT_FOUND"
  | "EVENT_MISMATCH"
  | "QUANTITY_MISMATCH"
  | "INVALID_STATUS";

export type ProcessSeatsReservedResult =
  | { duplicate: true; confirmed: false; reason: "DUPLICATE_MESSAGE" }
  | { duplicate: false; confirmed: true; booking: BookingDto; outboxRowId: string }
  | {
      duplicate: false;
      confirmed: false;
      reason: BookingProcessingFailureReason;
    };

export type ProcessSeatReservationFailedResult =
  | { duplicate: true; failed: false; reason: "DUPLICATE_MESSAGE" }
  | { duplicate: false; failed: true; booking: BookingDto; outboxRowId: string }
  | {
      duplicate: false;
      failed: false;
      reason: BookingProcessingFailureReason;
    };

export type CancelBookingResult =
  | { cancelled: true; booking: BookingDto; outboxRowId: string }
  | { cancelled: false; reason: "BOOKING_NOT_FOUND" | "INVALID_STATUS" };

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
    updateMany(input: {
      where: Partial<{
        id: string;
        status: BookingStatus;
        eventId: string;
        quantity: number;
      }>;
      data: Partial<{
        status: BookingStatus;
        updatedAt: Date;
      }>;
    }): Promise<{ count: number }>;
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
    create(input: {
      data: { messageId: string };
    }): Promise<{
      messageId: string;
      processedAt: Date;
    }>;
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
    }): Promise<BookingOutboxRecord>;
    findUnique(input: { where: { id: string } }): Promise<BookingOutboxRecord | null>;
    findMany(input?: {
      where?: { status?: BookingOutboxStatus };
      orderBy?: { createdAt?: "asc" | "desc" };
      take?: number;
    }): Promise<BookingOutboxRecord[]>;
    update(input: {
      where: { id: string };
      data: Partial<{
        status: BookingOutboxStatus;
        attempts: number;
        lastError: string | null;
        publishedAt: Date | null;
        updatedAt: Date;
      }>;
    }): Promise<BookingOutboxRecord>;
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
  createBookingWithOutbox(
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
  ): Promise<BookingDto>;
  findById(id: string): Promise<BookingDto | null>;
  findByUserId(userId: string): Promise<BookingDto[]>;
  findByIdempotencyKey(key: string): Promise<BookingDto | null>;
  updateStatus(id: string, status: BookingStatus): Promise<BookingDto | null>;
  processSeatsReservedMessage(input: {
    messageId: string;
    bookingId: string;
    eventId: string;
    quantity: number;
    outboxOnSuccess: {
      id: string;
      topic: Topic;
      message: MessageEnvelope<unknown>;
    };
  }): Promise<ProcessSeatsReservedResult>;
  processSeatReservationFailedMessage(input: {
    messageId: string;
    bookingId: string;
    eventId: string;
    reason: "INSUFFICIENT_SEATS" | "EVENT_NOT_FOUND";
    outboxOnFailure: {
      id: string;
      topic: Topic;
      message: MessageEnvelope<unknown>;
    };
  }): Promise<ProcessSeatReservationFailedResult>;
  cancelBookingWithOutbox(input: {
    id: string;
    outbox: {
      id: string;
      topic: Topic;
      message: MessageEnvelope<unknown>;
    };
  }): Promise<CancelBookingResult>;
  storeIdempotencyKey(input: {
    key: string;
    bookingId: string;
    response: unknown;
  }): Promise<void>;
  findIdempotencyResponse(key: string): Promise<unknown>;
  hasProcessedMessage(messageId: string): Promise<boolean>;
  markMessageProcessed(messageId: string): Promise<void>;
  findPendingOutboxMessages(limit?: number): Promise<BookingOutboxRecord[]>;
  markOutboxPublished(id: string): Promise<void>;
  recordOutboxFailure(id: string, error: string): Promise<void>;
}
