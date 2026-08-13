import type { EventDto } from "../../modules/events/event.repository";

export interface EventCache {
  get(eventId: string): Promise<EventDto | null>;
  set(eventId: string, event: EventDto, ttlSeconds: number): Promise<void>;
  del(eventId: string): Promise<void>;
}

export class InMemoryEventCache implements EventCache {
  private readonly store = new Map<string, EventDto>();

  async get(eventId: string): Promise<EventDto | null> {
    return this.store.get(eventId) ?? null;
  }

  async set(eventId: string, event: EventDto): Promise<void> {
    this.store.set(eventId, event);
  }

  async del(eventId: string): Promise<void> {
    this.store.delete(eventId);
  }
}
