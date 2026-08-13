import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.string().default("info")
});

export type EventServiceEnv = z.infer<typeof schema>;

export function loadEventServiceEnv(env: NodeJS.ProcessEnv = process.env): EventServiceEnv {
  return schema.parse(env);
}
