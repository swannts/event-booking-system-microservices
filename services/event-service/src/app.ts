import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { createLogger } from "@event-booking/logger";
import { ensureEventsTable, PostgresEventRepository, type DatabaseClient } from "./infrastructure/database/event-repository";
import type { EventCache } from "./infrastructure/cache/event-cache";
import { InMemoryEventCache } from "./infrastructure/cache/event-cache";
import { errorHandler } from "./middleware/error-handler";
import { createEventRouter } from "./modules/events/event.routes";
import { EventsService } from "./modules/events/event.service";

export type EventServiceDependencies = {
  db: DatabaseClient;
  cache?: EventCache;
  cacheTtlSeconds?: number;
};

export async function createEventApp({
  db,
  cache = new InMemoryEventCache(),
  cacheTtlSeconds = 120
}: EventServiceDependencies): Promise<Express> {
  await ensureEventsTable(db);

  const app = express();
  const logger = createLogger("event-service");
  const repository = new PostgresEventRepository(db);
  const service = new EventsService(repository, cache, cacheTtlSeconds);

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger }));

  app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", async (_req, res) => {
    await db.query("SELECT 1");
    res.json({ status: "ok" });
  });

  app.use("/events", createEventRouter(service));
  app.use(errorHandler);

  return app;
}
