import { Topics } from "@event-booking/contracts";
import { KafkaConsumerRunner, type KafkaConsumerConfig } from "@event-booking/messaging";
import { BookingEventsConsumer } from "./consumers/seats-reserved.consumer";
import type { BookingPublisher, BookingRepository } from "../../modules/bookings/booking.types";

export type BookingMessagingController = {
  consumerRunner: KafkaConsumerRunner;
  start(): Promise<void>;
  stop(): Promise<void>;
};

export function createBookingMessaging(dependencies: {
  kafkaConfig: KafkaConsumerConfig;
  repository: BookingRepository;
  publisher: BookingPublisher;
}): BookingMessagingController {
  const consumer = new BookingEventsConsumer(dependencies.repository, dependencies.publisher);
  const consumerRunner = new KafkaConsumerRunner(
    {
      clientId: dependencies.kafkaConfig.clientId,
      brokers: dependencies.kafkaConfig.brokers,
      groupId: dependencies.kafkaConfig.groupId
    },
    [
      {
        topic: Topics.SEATS_RESERVED,
        handler: (message) => consumer.handleSeatsReserved(message as never)
      },
      {
        topic: Topics.SEAT_RESERVATION_FAILED,
        handler: (message) => consumer.handleSeatReservationFailed(message as never)
      }
    ]
  );

  return {
    consumerRunner,
    async start() {
      await consumerRunner.start();
    },
    async stop() {
      await consumerRunner.stop();
    }
  };
}
