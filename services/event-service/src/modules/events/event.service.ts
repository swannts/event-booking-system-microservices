import { randomUUID } from "crypto";
import { EventErrors, AppError } from "./event-errors";
import type { EventCache } from "../../infrastructure/cache/event-cache";
import type { EventDto, PostgresEventRepository } from "../../infrastructure/database/event-repository";

export class EventsService {
  constructor(
    private readonly repository: PostgresEventRepository,
    private readonly cache: EventCache,
    private readonly cacheTtlSeconds: number
  ) {}

  async createEvent(input: { title: string; date: string; totalSeats: number }): Promise<EventDto> {
    return this.repository.create({
      id: randomUUID(),
      title: input.title,
      date: input.date,
      totalSeats: input.totalSeats
    });
  }

  async listEvents(): Promise<EventDto[]> {
    return this.repository.list();
  }

  async getEventById(id: string): Promise<EventDto> {
    const cached = await this.cache.get(id);
    if (cached) {
      return cached;
    }

    const event = await this.repository.findById(id);
    if (!event) {
      throw EventErrors.notFound();
    }

    await this.cache.set(id, event, this.cacheTtlSeconds);
    return event;
  }

  async updateEvent(
    id: string,
    input: { title: string; date: string; totalSeats: number }
  ): Promise<EventDto> {
    try {
      const updated = await this.repository.update(id, input);
      if (!updated) {
        throw EventErrors.notFound();
      }

      await this.cache.del(id);
      return updated;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if (error instanceof Error && error.message === "AVAILABLE_SEATS_CANNOT_EXCEED_TOTAL_SEATS") {
        throw EventErrors.validation("availableSeats cannot exceed totalSeats");
      }
      throw error;
    }
  }

  async deleteEvent(id: string): Promise<void> {
    const deleted = await this.repository.delete(id);
    if (!deleted) {
      throw EventErrors.notFound();
    }

    await this.cache.del(id);
  }
}
