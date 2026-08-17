import { Topics } from "@event-booking/contracts";
import { createKafkaSubscription, KafkaConsumerRunner, type KafkaConsumerConfig } from "@event-booking/messaging";
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
      createKafkaSubscription(Topics.BOOKING_CONFIRMED, (message) => consumer.handleBookingConfirmed(message)),
      createKafkaSubscription(Topics.BOOKING_FAILED, (message) => consumer.handleBookingFailed(message)),
      createKafkaSubscription(Topics.BOOKING_CANCELLED, (message) => consumer.handleBookingCancelled(message))
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
