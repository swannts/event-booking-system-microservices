import { Topics } from "@event-booking/contracts";
import { KafkaConsumerRunner, type KafkaConsumerConfig } from "@event-booking/messaging";
import { BookingReservationConsumer } from "./consumers/reserve-seats.consumer";
import { ReleaseSeatsConsumer } from "./consumers/release-seats.consumer";
import type { InventoryService } from "../../modules/inventory/inventory.service";

export type EventMessagingController = {
  consumerRunner: KafkaConsumerRunner;
  start(): Promise<void>;
  stop(): Promise<void>;
};

export function createEventMessaging(dependencies: {
  kafkaConfig: KafkaConsumerConfig;
  inventoryService: InventoryService;
}): EventMessagingController {
  const reserveConsumer = new BookingReservationConsumer(dependencies.inventoryService);
  const releaseConsumer = new ReleaseSeatsConsumer(dependencies.inventoryService);

  const consumerRunner = new KafkaConsumerRunner(
    {
      clientId: dependencies.kafkaConfig.clientId,
      brokers: dependencies.kafkaConfig.brokers,
      groupId: dependencies.kafkaConfig.groupId
    },
    [
      {
        topic: Topics.RESERVE_SEATS,
        handler: (message) => reserveConsumer.handle(message as never)
      },
      {
        topic: Topics.RELEASE_SEATS,
        handler: (message) => releaseConsumer.handle(message as never)
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
