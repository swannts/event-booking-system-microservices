import express, { type Express, type RequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { createHttpLogger } from "@event-booking/logger";
import {
  PrismaEventRepository,
  type EventDatabaseClient,
  type EventRepository
} from "./modules/events/event.repository";
import type { EventCache } from "./infrastructure/cache/event.cache";
import { InMemoryEventCache } from "./infrastructure/cache/event.cache";
import { errorHandler } from "./middleware/error-handler";
import { requestIdMiddleware } from "./middleware/request-id";
import { createEventRouter } from "./modules/events/event.routes";
import { EventsService } from "./modules/events/event.service";
import { EventController } from "./modules/events/event.controller";
import type { MessagePublisher } from "./infrastructure/messaging/message-publisher";
import { InMemoryMessagePublisher } from "./infrastructure/messaging/message-publisher";
import { notFoundHandler } from "./middleware/not-found";

export type EventServiceDependencies = {
  db: EventDatabaseClient;
  cache?: EventCache;
  cacheTtlSeconds?: number;
  publisher?: MessagePublisher;
  repository?: EventRepository;
  service?: EventsService;
};

export async function createEventApp({
  db,
  cache = new InMemoryEventCache(),
  cacheTtlSeconds = 120,
  publisher = new InMemoryMessagePublisher(),
  repository,
  service
}: EventServiceDependencies): Promise<Express> {
  const app = express();
  const httpLogger = createHttpLogger("event-service");
  const eventRepository = repository ?? new PrismaEventRepository(db);
  const eventService = service ?? new EventsService(eventRepository, cache, cacheTtlSeconds);
  const controller = new EventController(eventService);
  void publisher;

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
  app.get("/health/ready", async (_req, res) => {
    await db.$connect();
    res.json({ status: "ok" });
  });

  app.use("/events", createEventRouter(controller));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
