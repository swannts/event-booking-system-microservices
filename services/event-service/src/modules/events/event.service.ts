import { randomUUID } from "crypto";
import { EventErrors, AppError } from "./event.errors";
import { CapacityBelowReservedSeatsError } from "./event.repository";
import { createLogger, type AppLogger } from "@event-booking/logger";
import type { EventCache } from "../../infrastructure/cache/event-cache";
import type { EventDto, EventRepository } from "./event.types";
import { observeDomain } from "@event-booking/observability";

export class EventsService {
  constructor(
    private readonly repository: EventRepository,
    private readonly cache: EventCache,
    private readonly cacheTtlSeconds: number,
    private readonly logger: AppLogger = createLogger("event-service")
  ) {}

  private async getCached(id: string): Promise<EventDto | null> {
    try {
      const cached = await this.cache.get(id);
      observeDomain("event-service", "cache_get", cached ? "hit" : "miss");
      return cached;
    } catch (error) {
      observeDomain("event-service", "cache_get", "error");
      this.logger.warn({ eventId: id, error }, "Event cache read failed; falling back to database");
      return null;
    }
  }

  private async setCached(id: string, event: EventDto): Promise<void> {
    try {
      await this.cache.set(id, event, this.cacheTtlSeconds);
    } catch (error) {
      observeDomain("event-service", "cache_set", "error");
      this.logger.warn({ eventId: id, error }, "Event cache write failed; returning database result");
    }
  }

  private async invalidateCached(id: string): Promise<void> {
    try {
      await this.cache.del(id);
    } catch (error) {
      observeDomain("event-service", "cache_delete", "error");
      this.logger.warn({ eventId: id, error }, "Event cache invalidation failed; cached value will expire by TTL");
    }
  }

  async createEvent(input: { title: string; date: string; totalSeats: number }): Promise<EventDto> {
    return this.repository.create({
      id: randomUUID(),
      title: input.title,
      date: input.date,
      totalSeats: input.totalSeats
    });
  }

  async listEvents(pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 }): Promise<EventDto[]> {
    return this.repository.list(pagination);
  }

  async getEventById(id: string): Promise<EventDto> {
    const cached = await this.getCached(id);
    if (cached) {
      return cached;
    }

    const event = await this.repository.findById(id);
    if (!event) {
      throw EventErrors.notFound();
    }

    await this.setCached(id, event);
    return event;
  }

  async updateEvent(id: string, input: { title: string; date: string; totalSeats: number }): Promise<EventDto> {
    try {
      const updated = await this.repository.update(id, input);
      if (!updated) {
        throw EventErrors.notFound();
      }

      await this.invalidateCached(id);
      return updated;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if (error instanceof CapacityBelowReservedSeatsError) {
        throw EventErrors.capacityBelowReservedSeats();
      }
      throw error;
    }
  }

  async deleteEvent(id: string): Promise<void> {
    const result = await this.repository.delete(id);
    if (result === "NOT_FOUND") {
      throw EventErrors.notFound();
    }
    if (result === "HAS_RESERVATIONS") {
      throw EventErrors.hasReservations();
    }

    await this.invalidateCached(id);
  }
}
