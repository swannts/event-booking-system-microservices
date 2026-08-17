import express, { type Express, type RequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { createHttpLogger } from "@event-booking/logger";
import { requestIdMiddleware } from "./middleware/request-id";
import { createNotificationConsumer } from "./modules/notifications/notification-consumer";
import type { NotificationSink } from "./infrastructure/notifications/notification-sink";
import { paginationQuerySchema } from "@event-booking/contracts";
import { httpMetrics, metricsHandler, readinessHandler } from "@event-booking/observability";
import { ZodError } from "zod";

export type NotificationServiceDependencies = {
  sink: NotificationSink;
  readiness?: () => Promise<void>;
  kafkaReady?: () => boolean;
};

export async function createNotificationApp({
  sink,
  readiness = async () => undefined,
  kafkaReady = () => true
}: NotificationServiceDependencies): Promise<Express> {
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
  app.use(httpMetrics("notification-service"));

  app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
  app.get(
    "/health/ready",
    readinessHandler({
      database: readiness,
      kafka: async () => {
        if (!kafkaReady()) throw new Error("Kafka consumer is not running");
      }
    })
  );
  app.get("/metrics", metricsHandler);
  app.get("/notifications", async (req, res, next) => {
    try {
      res.json(await consumer.list(paginationQuerySchema.parse(req.query)));
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: error.issues } });
      return;
    }
    next(error);
  });

  return app;
}
