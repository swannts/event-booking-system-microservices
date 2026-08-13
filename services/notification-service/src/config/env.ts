import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3003),
  KAFKA_BROKERS: z.string().min(1).default("localhost:9092"),
  KAFKA_CLIENT_ID: z.string().min(1).default("notification-service"),
  KAFKA_GROUP_ID: z.string().min(1).default("notification-service-consumers"),
  LOG_LEVEL: z.string().default("info")
});

export type NotificationServiceEnv = z.infer<typeof schema>;

export function loadNotificationServiceEnv(env: NodeJS.ProcessEnv = process.env) {
  return schema.parse(env);
}
