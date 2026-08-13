import { Topics } from "@event-booking/contracts";
import { KafkaConsumerRunner, KafkaMessagePublisher } from "@event-booking/messaging";
import { createLogger } from "@event-booking/logger";
import { createBookingApp } from "./app";
import { createBookingDatabase, createBookingKafkaConfig, loadBookingServiceEnv } from "./config";
import { PrismaBookingRepository } from "./infrastructure/database/booking-repository";
import { BookingOutboxDispatcher } from "./modules/bookings/booking-outbox.dispatcher";
import { BookingEventsConsumer } from "./modules/bookings/booking-events.consumer";
import { BookingController } from "./modules/bookings/booking.controller";
import { BookingsService } from "./modules/bookings/booking.service";

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
  const consumer = new BookingEventsConsumer(repository, publisher);
  const consumerRunner = new KafkaConsumerRunner(
    {
      clientId: kafkaConfig.clientId,
      brokers: kafkaConfig.brokers,
      groupId: kafkaConfig.groupId
    },
    [
      { topic: Topics.SEATS_RESERVED, handler: (message) => consumer.handleSeatsReserved(message as never) },
      {
        topic: Topics.SEAT_RESERVATION_FAILED,
        handler: (message) => consumer.handleSeatReservationFailed(message as never)
      }
    ]
  );
  await consumerRunner.start();
  outboxDispatcher.start();
  const app = await createBookingApp({
    db,
    publisher,
    repository,
    outboxDispatcher,
    service,
    controller
  });
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "Booking service listening");
  });

  const shutdown = () =>
    server.close(async () => {
      logger.info("Booking service shutting down");
      outboxDispatcher.stop();
      await consumerRunner.stop();
      await publisher.disconnect();
      await db.$disconnect();
      logger.info("Booking service stopped");
      process.exit(0);
    });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
