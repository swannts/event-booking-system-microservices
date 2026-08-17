import type { EventServiceEnv } from "./env";

export type EventKafkaConfig = {
  clientId: string;
  brokers: string[];
  groupId: string;
};

export function createEventKafkaConfig(env: EventServiceEnv): EventKafkaConfig {
  return {
    clientId: env.KAFKA_CLIENT_ID,
    brokers: env.KAFKA_BROKERS.split(",")
      .map((broker) => broker.trim())
      .filter(Boolean),
    groupId: env.KAFKA_GROUP_ID
  };
}
