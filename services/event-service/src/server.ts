import { createClient } from "redis";
import { loadEventServiceEnv } from "./config/env";
import { createEventApp } from "./app";
import { createEventDatabase } from "./config/database";
import type { EventCache } from "./infrastructure/cache/event-cache";

class RedisEventCache implements EventCache {
  constructor(private readonly client: ReturnType<typeof createClient>) {}

  async get(eventId: string) {
    const value = await this.client.get(`event:${eventId}`);
    return value ? JSON.parse(value) : null;
  }

  async set(eventId: string, event: unknown, ttlSeconds: number) {
    await this.client.set(`event:${eventId}`, JSON.stringify(event), { EX: ttlSeconds });
  }

  async del(eventId: string) {
    await this.client.del(`event:${eventId}`);
  }
}

async function main() {
  const env = loadEventServiceEnv();
  const db = createEventDatabase(env.DATABASE_URL);
  await db.$connect();
  const redis = createClient({ url: env.REDIS_URL });
  redis.on("error", (error) => {
    console.error("redis error", error);
  });
  await redis.connect();

  const app = await createEventApp({
    db,
    cache: new RedisEventCache(redis),
    cacheTtlSeconds: env.CACHE_TTL_SECONDS
  });
  const server = app.listen(env.PORT, () => {
    console.log(`event-service listening on ${env.PORT}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await redis.quit();
      await db.$disconnect();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
