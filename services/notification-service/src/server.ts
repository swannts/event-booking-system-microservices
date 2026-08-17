import { createLogger } from "@event-booking/logger";
import { loadNotificationServiceEnv } from "./config/env";
import { createNotificationKafkaConfig } from "./config/kafka";
import { createNotificationApp } from "./app";
import { createNotificationDatabase } from "./config/database";
import { PrismaNotificationRepository } from "./infrastructure/notifications/notification.repository";
import { createNotificationMessaging } from "./infrastructure/messaging/messaging.bootstrap";

async function main() {
  const env = loadNotificationServiceEnv();
  const logger = createLogger("notification-service");
  const kafkaConfig = createNotificationKafkaConfig(env);
  const db = createNotificationDatabase(env.DATABASE_URL);
  await db.$connect();
  const sink = new PrismaNotificationRepository(db);

  const messaging = createNotificationMessaging({
    kafkaConfig,
    sink
  });

  await messaging.start();

  const app = await createNotificationApp({
    sink,
    readiness: async () => {
      await db.$queryRaw`SELECT 1`;
    },
    kafkaReady: () => messaging.consumerRunner.isRunning()
  });
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "Notification service listening");
  });

  const shutdown = () =>
    server.close(async () => {
      logger.info("Notification service shutting down");
      await messaging.stop();
      await db.$disconnect();
      logger.info("Notification service stopped");
      process.exit(0);
    });

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
