import { Topics } from "@event-booking/contracts";
import { KafkaConsumerRunner, KafkaMessagePublisher } from "@event-booking/messaging";
import { createLogger } from "@event-booking/logger";
import { loadEventServiceEnv } from "./config/env";
import { createEventApp } from "./app";
import { createEventDatabase } from "./config/database";
import { createEventKafkaConfig } from "./config/kafka";
import { createEventRedisClient } from "./config/redis";
import { RedisEventCache } from "./infrastructure/cache/redis.client";
import { PrismaEventRepository } from "./modules/events/event.repository";
import { EventsService } from "./modules/events/event.service";
import { PrismaInventoryRepository } from "./modules/inventory/inventory.repository";
import { InventoryService } from "./modules/inventory/inventory.service";
import { BookingReservationConsumer } from "./infrastructure/messaging/consumers/reserve-seats.consumer";
import { ReleaseSeatsConsumer } from "./infrastructure/messaging/consumers/release-seats.consumer";

async function main() {
  const env = loadEventServiceEnv();
  const logger = createLogger("event-service");
  const db = createEventDatabase(env.DATABASE_URL);
  await db.$connect();
  const kafkaConfig = createEventKafkaConfig(env);
  const redis = createEventRedisClient(env.REDIS_URL);
  redis.on("error", (error) => {
    logger.error({ error }, "Redis client error");
  });
  await redis.connect();
  const publisher = new KafkaMessagePublisher(kafkaConfig);
  const cache = new RedisEventCache(redis);
  const repository = new PrismaEventRepository(db);
  const inventoryRepository = new PrismaInventoryRepository(db);
  const service = new EventsService(repository, cache, env.CACHE_TTL_SECONDS);
  const inventoryService = new InventoryService({
    repository: inventoryRepository,
    cache,
    publisher
  });
  const consumer = new BookingReservationConsumer(inventoryRepository, cache, publisher);
  const releaseConsumer = new ReleaseSeatsConsumer(inventoryService);
  const consumerRunner = new KafkaConsumerRunner(
    {
      clientId: kafkaConfig.clientId,
      brokers: kafkaConfig.brokers,
      groupId: kafkaConfig.groupId
    },
    [
      {
        topic: Topics.RESERVE_SEATS,
        handler: (message) => consumer.handle(message as never)
      },
      {
        topic: Topics.RELEASE_SEATS,
        handler: (message) => releaseConsumer.handle(message as never)
      }
    ]
  );
  await consumerRunner.start();

  const app = await createEventApp({
    db,
    cache,
    cacheTtlSeconds: env.CACHE_TTL_SECONDS,
    publisher,
    repository,
    service
  });
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "Event service listening");
  });

  const shutdown = async () => {
    server.close(async () => {
      logger.info("Event service shutting down");
      await consumerRunner.stop();
      await publisher.disconnect();
      await redis.quit();
      await db.$disconnect();
      logger.info("Event service stopped");
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
