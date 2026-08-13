import { Topics } from "@event-booking/contracts";
import { KafkaConsumerRunner } from "@event-booking/messaging";
import { createLogger } from "@event-booking/logger";
import { loadNotificationServiceEnv } from "./config/env";
import { createNotificationKafkaConfig } from "./config/kafka";
import { createNotificationApp } from "./app";
import { createNotificationConsumer } from "./modules/notifications/notification-consumer";
import { InMemoryNotificationStore } from "./infrastructure/notifications/notification-store";

async function main() {
  const env = loadNotificationServiceEnv();
  const logger = createLogger("notification-service");
  const kafkaConfig = createNotificationKafkaConfig(env);
  const sink = new InMemoryNotificationStore();
  const consumer = createNotificationConsumer(sink);
  const consumerRunner = new KafkaConsumerRunner(
    {
      clientId: kafkaConfig.clientId,
      brokers: kafkaConfig.brokers,
      groupId: kafkaConfig.groupId
    },
    [
      { topic: Topics.BOOKING_CONFIRMED, handler: (message) => consumer.handleBookingConfirmed(message as never) },
      { topic: Topics.BOOKING_FAILED, handler: (message) => consumer.handleBookingFailed(message as never) },
      { topic: Topics.BOOKING_CANCELLED, handler: (message) => consumer.handleBookingCancelled(message as never) }
    ]
  );
  await consumerRunner.start();
  const app = await createNotificationApp({ sink });
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "Notification service listening");
  });

  const shutdown = () =>
    server.close(async () => {
      logger.info("Notification service shutting down");
      await consumerRunner.stop();
      logger.info("Notification service stopped");
      process.exit(0);
    });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
