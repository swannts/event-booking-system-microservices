import { KafkaMessagePublisher } from "@event-booking/messaging";
import { createLogger } from "@event-booking/logger";
import { createBookingApp } from "./app";
import { createBookingDatabase } from "./config/database";
import { createBookingKafkaConfig } from "./config/kafka";
import { loadBookingServiceEnv } from "./config/env";
import { PrismaBookingRepository } from "./modules/bookings/booking.repository";
import { BookingOutboxDispatcher } from "./modules/bookings/booking-outbox.dispatcher";
import { BookingController } from "./modules/bookings/booking.controller";
import { BookingsService } from "./modules/bookings/booking.service";
import { createBookingMessaging } from "./infrastructure/messaging/messaging.bootstrap";

async function main() {
  const env = loadBookingServiceEnv();
  const logger = createLogger("booking-service");
  const db = createBookingDatabase(env.DATABASE_URL);
  await db.$connect();

  const kafkaConfig = createBookingKafkaConfig(env);
  const publisher = new KafkaMessagePublisher(kafkaConfig);
  const repository = new PrismaBookingRepository(db);
  const outboxDispatcher = new BookingOutboxDispatcher(repository, publisher);
  const service = new BookingsService(repository, outboxDispatcher);
  const controller = new BookingController(service);

  const messaging = createBookingMessaging({
    kafkaConfig,
    repository,
    outboxDispatcher
  });

  await messaging.start();
  outboxDispatcher.start();

  const app = await createBookingApp({
    db,
    publisher,
    repository,
    outboxDispatcher,
    service,
    controller,
    kafkaReady: () => messaging.consumerRunner.isRunning()
  });

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "Booking service listening");
  });

  const shutdown = () =>
    server.close(async () => {
      logger.info("Booking service shutting down");
      outboxDispatcher.stop();
      await messaging.stop();
      await publisher.disconnect();
      await db.$disconnect();
      logger.info("Booking service stopped");
      process.exit(0);
    });

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
