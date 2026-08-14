import { Prisma } from "../../../generated/prisma";
import type { EventDto, EventRecord } from "../events/event.repository";
import type { EventCache } from "../../infrastructure/cache/event-cache";
import type { MessagePublisher } from "../../infrastructure/messaging/message-publisher";
import type { InventoryRepository } from "./inventory.repository";

export type EventOutboxRecord = {
  id: string;
  topic: string;
  messageId: string;
  message: unknown;
  status: "PENDING" | "PUBLISHED";
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
};

export type PrimitiveTransactionClient = {
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
  eventOutboxEvent: {
    create(input: {
      data: {
        id: string;
        topic: string;
        messageId: string;
        message: Prisma.InputJsonValue;
        status?: "PENDING" | "PUBLISHED";
      };
    }): Promise<EventOutboxRecord>;
    findMany(input: {
      where: { status: "PENDING" };
      take?: number;
      orderBy?: { createdAt: "asc" };
    }): Promise<EventOutboxRecord[]>;
    update(input: {
      where: { id: string };
      data: {
        status?: "PENDING" | "PUBLISHED";
        attempts?: { increment: number };
        lastError?: string;
        publishedAt?: Date;
      };
    }): Promise<EventOutboxRecord>;
  };
  $queryRaw<T>(query: TemplateStringsArray | ReturnType<typeof Prisma.sql>): Promise<T>;
};

export type InventoryDatabaseClient = PrimitiveTransactionClient & {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $transaction<T>(fn: (tx: PrimitiveTransactionClient) => Promise<T>): Promise<T>;
};

export type ProcessReserveSeatsInput = {
  messageId: string;
  eventId: string;
  quantity: number;
  outboxOnSuccess?: { id: string; topic: string; messageId: string; message: unknown };
  outboxOnFailure?: {
    id: string;
    topic: string;
    messageId: string;
    correlationId: string;
    bookingId: string;
  };
};

export type ProcessReleaseSeatsInput = {
  messageId: string;
  eventId: string;
  quantity: number;
};

export type ReserveSeatsResult =
  | { duplicate: true; reserved: false; reason: "DUPLICATE_MESSAGE" }
  | { duplicate: false; reserved: true; event: EventDto; outboxRowId?: string }
  | {
      duplicate: false;
      reserved: false;
      reason: "INVALID_QUANTITY" | "EVENT_NOT_FOUND" | "INSUFFICIENT_SEATS";
      outboxRowId?: string;
    };

export type ReleaseSeatsResult =
  | { duplicate: true; released: false; reason: "DUPLICATE_MESSAGE" }
  | { duplicate: false; released: true; event: EventDto }
  | {
      duplicate: false;
      released: false;
      reason: "INVALID_QUANTITY" | "EVENT_NOT_FOUND" | "CAPACITY_EXCEEDED";
    };

export type InventoryDependencies = {
  repository: InventoryRepository;
  cache: EventCache;
  publisher: MessagePublisher;
};
