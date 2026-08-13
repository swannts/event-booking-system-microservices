import type { NotificationServiceEnv } from "./env";

export type NotificationKafkaConfig = {
  clientId: string;
  brokers: string[];
  groupId: string;
};

export function createNotificationKafkaConfig(env: NotificationServiceEnv): NotificationKafkaConfig {
  return {
    clientId: env.KAFKA_CLIENT_ID,
    brokers: env.KAFKA_BROKERS.split(",").map((broker) => broker.trim()).filter(Boolean),
    groupId: env.KAFKA_GROUP_ID
  };
}
