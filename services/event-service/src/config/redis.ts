import { createClient, type RedisClientType } from "redis";

export type EventRedisClient = RedisClientType;

export function createEventRedisClient(url: string): EventRedisClient {
  return createClient({ url });
}
