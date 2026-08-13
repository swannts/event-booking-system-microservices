import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@localhost:5432/event_booking"),
  LOG_LEVEL: z.string().default("info")
});

export type UserServiceEnv = z.infer<typeof schema>;

export function loadUserServiceEnv(env: NodeJS.ProcessEnv = process.env): UserServiceEnv {
  return schema.parse(env);
}
