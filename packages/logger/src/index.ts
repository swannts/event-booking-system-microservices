import { randomUUID } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import pino, { type Logger, type LoggerOptions } from "pino";

export function createLogger(service: string, level = process.env.LOG_LEVEL ?? "info") {
  const options: LoggerOptions = {
    level,
    base: {
      service
    }
  };

  return pino(options);
}

export function createHttpLogger(service: string, level = process.env.LOG_LEVEL ?? "info") {
  const logger = createLogger(service, level);

  return {
    logger,
    genReqId: (req: IncomingMessage & { id?: string }, _res: ServerResponse) =>
      (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
    customProps: (req: IncomingMessage & { id?: string }) => ({
      requestId: req.headers["x-request-id"] ?? req.id,
      correlationId: req.headers["x-correlation-id"]
    })
  };
}

export type AppLogger = Logger;
