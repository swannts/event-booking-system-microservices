import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { createLogger } from "@event-booking/logger";
import { ensureBookingTables, PostgresBookingRepository, type BookingDatabaseClient } from "./infrastructure/database/booking-repository";
import { InMemoryMessagePublisher, type MessagePublisher } from "./infrastructure/messaging/message-publisher";
import { errorHandler } from "./middleware/error-handler";
import { createBookingRouter } from "./modules/bookings/booking.routes";
import { BookingsService } from "./modules/bookings/booking.service";

export type BookingServiceDependencies = {
  db: BookingDatabaseClient;
  publisher?: MessagePublisher;
};

export async function createBookingApp({ db, publisher = new InMemoryMessagePublisher() }: BookingServiceDependencies): Promise<Express> {
  await ensureBookingTables(db);

  const app = express();
  const logger = createLogger("booking-service");
  const repository = new PostgresBookingRepository(db);
  const service = new BookingsService(repository, publisher);

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

  app.use("/bookings", createBookingRouter(service));
  app.use(errorHandler);

  return app;
}
