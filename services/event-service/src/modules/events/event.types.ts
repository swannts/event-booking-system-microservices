import type { Event as EventModel } from "../../../generated/prisma";
import type { Prisma } from "../../../generated/prisma";
import type { EventCache } from "../../infrastructure/cache/event-cache";
import type { MessagePublisher } from "../../infrastructure/messaging/message-publisher";

export type EventRecord = EventModel;

export type EventDto = {
  id: string;
  title: string;
  date: string;
  totalSeats: number;
  availableSeats: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateEventInput = {
  id: string;
  title: string;
  date: string;
  totalSeats: number;
  availableSeats?: number;
};

export type UpdateEventInput = {
  title: string;
  date: string;
  totalSeats: number;
};

export type EventDatabaseClient = {
  event: {
    create(input: {
      data: { id: string; title: string; date: Date; totalSeats: number; availableSeats: number };
    }): Promise<EventRecord>;
    findUnique(input: { where: { id: string } }): Promise<EventRecord | null>;
    findMany(input?: unknown): Promise<EventRecord[]>;
    update(input: {
      where: { id: string };
      data: {
        title?: string;
        date?: Date;
        totalSeats?: number;
        availableSeats?: number;
      };
    }): Promise<EventRecord>;
    deleteMany(input: { where: { id: string } }): Promise<{ count: number }>;
    updateMany(input: {
      where: { id: string; availableSeats?: { gte: number } };
      data: {
        availableSeats?: { decrement?: number; increment?: number };
        updatedAt?: Date;
      };
    }): Promise<{ count: number }>;
  };
  $queryRaw<T>(query: ReturnType<typeof Prisma.sql>): Promise<T>;
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
};

export interface EventRepository {
  create(input: CreateEventInput): Promise<EventDto>;
  findById(id: string): Promise<EventDto | null>;
  list(pagination?: { page: number; pageSize: number }): Promise<EventDto[]>;
  update(id: string, input: UpdateEventInput): Promise<EventDto | null>;
  delete(id: string): Promise<"DELETED" | "NOT_FOUND" | "HAS_RESERVATIONS">;
}

export type EventDependencies = {
  repository: EventRepository;
  cache: EventCache;
  publisher: MessagePublisher;
};
