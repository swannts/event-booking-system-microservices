import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@localhost:5432/event_booking"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  KAFKA_BROKERS: z.string().min(1).default("localhost:9092"),
  KAFKA_CLIENT_ID: z.string().min(1).default("event-service"),
  KAFKA_GROUP_ID: z.string().min(1).default("event-service-consumers"),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  LOG_LEVEL: z.string().default("info")
});

export type EventServiceEnv = z.infer<typeof schema>;

export function loadEventServiceEnv(env: NodeJS.ProcessEnv = process.env): EventServiceEnv {
  return schema.parse(env);
}
