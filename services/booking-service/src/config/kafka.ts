import type { BookingServiceEnv } from "./env";

export type BookingKafkaConfig = {
  clientId: string;
  brokers: string[];
  groupId: string;
};

export function createBookingKafkaConfig(env: BookingServiceEnv): BookingKafkaConfig {
  return {
    clientId: env.KAFKA_CLIENT_ID,
    brokers: env.KAFKA_BROKERS.split(",")
      .map((broker) => broker.trim())
      .filter(Boolean),
    groupId: env.KAFKA_GROUP_ID
  };
}
