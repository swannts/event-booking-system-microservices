import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3002),
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@localhost:5432/event_booking"),
  KAFKA_BROKERS: z.string().min(1).default("localhost:9092"),
  KAFKA_CLIENT_ID: z.string().min(1).default("booking-service"),
  KAFKA_GROUP_ID: z.string().min(1).default("booking-service-consumers"),
  LOG_LEVEL: z.string().default("info")
});

export type BookingServiceEnv = z.infer<typeof schema>;

export function loadBookingServiceEnv(env: NodeJS.ProcessEnv = process.env): BookingServiceEnv {
  return schema.parse(env);
}
