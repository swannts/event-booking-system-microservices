import { Topics } from "@event-booking/contracts";
import { KafkaConsumerRunner, type KafkaConsumerConfig } from "@event-booking/messaging";
import { BookingEventsConsumer } from "./consumers/seats-reserved.consumer";
import type { BookingRepository } from "../../modules/bookings/booking.repository";
import type { BookingOutboxDispatcher } from "../../modules/bookings/booking-outbox.dispatcher";

export type BookingMessagingController = {
  consumerRunner: KafkaConsumerRunner;
  start(): Promise<void>;
  stop(): Promise<void>;
};

export function createBookingMessaging(dependencies: {
  kafkaConfig: KafkaConsumerConfig;
  repository: BookingRepository;
  outboxDispatcher: BookingOutboxDispatcher;
}): BookingMessagingController {
  const consumer = new BookingEventsConsumer(dependencies.repository, dependencies.outboxDispatcher);
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
