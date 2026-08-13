import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { createLogger } from "@event-booking/logger";
import { PrismaBookingRepository, type BookingDatabaseClient } from "./infrastructure/database/booking-repository";
import { InMemoryMessagePublisher, type MessagePublisher } from "./infrastructure/messaging/message-publisher";
import { errorHandler } from "./middleware/error-handler";
import { BookingController } from "./modules/bookings/booking.controller";
import { createBookingRouter } from "./modules/bookings/booking.routes";
import { BookingsService } from "./modules/bookings/booking.service";

export type BookingServiceDependencies = {
  db: BookingDatabaseClient;
  publisher?: MessagePublisher;
};

export async function createBookingApp({ db, publisher = new InMemoryMessagePublisher() }: BookingServiceDependencies): Promise<Express> {
  const app = express();
  const logger = createLogger("booking-service");
  const repository = new PrismaBookingRepository(db);
  const service = new BookingsService(repository, publisher);
  const controller = new BookingController(service);

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger }));

  app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", async (_req, res) => {
    await db.$connect();
    res.json({ status: "ok" });
  });

  app.use("/bookings", createBookingRouter(controller));
  app.use(errorHandler);

  return app;
}
