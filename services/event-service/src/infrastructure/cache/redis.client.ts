import type { RedisClientType } from "redis";
import { eventCacheKey } from "./cache-keys";
import type { EventDto } from "../../modules/events/event.repository";

export class RedisEventCache {
  constructor(private readonly client: RedisClientType) {}

  async get(eventId: string): Promise<EventDto | null> {
    const value = await this.client.get(eventCacheKey(eventId));
    return value ? (JSON.parse(value) as EventDto) : null;
  }

  async set(eventId: string, event: EventDto, ttlSeconds: number): Promise<void> {
    await this.client.set(eventCacheKey(eventId), JSON.stringify(event), { EX: ttlSeconds });
  }

  async del(eventId: string): Promise<void> {
    await this.client.del(eventCacheKey(eventId));
  }
}
