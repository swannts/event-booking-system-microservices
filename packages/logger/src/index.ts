import pino, { type LoggerOptions } from "pino";

export function createLogger(service: string, level = process.env.LOG_LEVEL ?? "info") {
  const options: LoggerOptions = {
    level,
    base: {
      service
    }
  };

  return pino(options);
}
