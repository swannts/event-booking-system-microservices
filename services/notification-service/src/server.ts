import { createLogger } from "@event-booking/logger";
import { loadNotificationServiceEnv } from "./config/env";
import { createNotificationKafkaConfig } from "./config/kafka";
import { createNotificationApp } from "./app";
import { InMemoryNotificationStore } from "./infrastructure/notifications/notification-store";
import { createNotificationMessaging } from "./infrastructure/messaging/messaging.bootstrap";

async function main() {
  const env = loadNotificationServiceEnv();
  const logger = createLogger("notification-service");
  const kafkaConfig = createNotificationKafkaConfig(env);
  const sink = new InMemoryNotificationStore();

  const messaging = createNotificationMessaging({
    kafkaConfig,
    sink
  });

  await messaging.start();

  const app = await createNotificationApp({ sink });
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "Notification service listening");
  });

  const shutdown = () =>
    server.close(async () => {
      logger.info("Notification service shutting down");
      await messaging.stop();
      logger.info("Notification service stopped");
      process.exit(0);
    });

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
