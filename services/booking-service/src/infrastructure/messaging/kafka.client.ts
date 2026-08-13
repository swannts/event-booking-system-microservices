export type BookingKafkaClientConfig = {
  clientId: string;
  brokers: string[];
  groupId: string;
};

export function createBookingKafkaClientConfig(config: BookingKafkaClientConfig): BookingKafkaClientConfig {
  return config;
}
