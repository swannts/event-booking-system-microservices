import express, { type Express, type RequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { createHttpLogger } from "@event-booking/logger";
import { requestIdMiddleware } from "./middleware/request-id";
import { createNotificationConsumer } from "./modules/notifications/notification-consumer";
import { InMemoryNotificationStore } from "./infrastructure/notifications/notification-store";
import type { NotificationSink } from "./infrastructure/notifications/notification-sink";

export type NotificationServiceDependencies = {
  sink?: NotificationSink;
};

export async function createNotificationApp({
  sink = new InMemoryNotificationStore()
}: NotificationServiceDependencies = {}): Promise<Express> {
  const app = express();
  const httpLogger = createHttpLogger("notification-service");
  const consumer = createNotificationConsumer(sink);

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(requestIdMiddleware);
  const httpMiddleware = pinoHttp({
    logger: httpLogger.logger,
    genReqId: httpLogger.genReqId,
    customProps: httpLogger.customProps
  });
  app.use(httpMiddleware as unknown as RequestHandler);

  app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", (_req, res) => res.json({ status: "ok" }));
  app.get("/notifications", (_req, res) => res.json(consumer.list()));

  return app;
}
