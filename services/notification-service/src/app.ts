import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { createLogger } from "@event-booking/logger";

export async function createNotificationApp(): Promise<Express> {
  const app = express();
  const logger = createLogger("notification-service");

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger }));

  app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", (_req, res) => res.json({ status: "ok" }));

  return app;
}
