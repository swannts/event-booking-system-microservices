import { Topics } from "@event-booking/contracts";
import { KafkaConsumerRunner, type KafkaConsumerConfig } from "@event-booking/messaging";
import { createNotificationConsumer } from "../../modules/notifications/notification-consumer";
import type { NotificationSink } from "../../modules/notifications/notification.types";

export type NotificationMessagingController = {
  consumerRunner: KafkaConsumerRunner;
  start(): Promise<void>;
  stop(): Promise<void>;
};

export function createNotificationMessaging(dependencies: {
  kafkaConfig: KafkaConsumerConfig;
  sink: NotificationSink;
}): NotificationMessagingController {
  const consumer = createNotificationConsumer(dependencies.sink);

  const consumerRunner = new KafkaConsumerRunner(
    {
      clientId: dependencies.kafkaConfig.clientId,
      brokers: dependencies.kafkaConfig.brokers,
      groupId: dependencies.kafkaConfig.groupId
    },
    [
      {
        topic: Topics.BOOKING_CONFIRMED,
        handler: (message) => consumer.handleBookingConfirmed(message as never)
      },
      {
        topic: Topics.BOOKING_FAILED,
        handler: (message) => consumer.handleBookingFailed(message as never)
      },
      {
        topic: Topics.BOOKING_CANCELLED,
        handler: (message) => consumer.handleBookingCancelled(message as never)
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
