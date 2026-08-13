import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3002),
  LOG_LEVEL: z.string().default("info")
});

export function loadBookingServiceEnv(env: NodeJS.ProcessEnv = process.env) {
  return schema.parse(env);
}
