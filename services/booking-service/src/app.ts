import express, { type Express, type RequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { createHttpLogger } from "@event-booking/logger";
import {
  PrismaBookingRepository,
  type BookingDatabaseClient,
  type BookingRepository
} from "./modules/bookings/booking.repository";
import { InMemoryMessagePublisher, type MessagePublisher } from "./infrastructure/messaging/message-publisher";
import { errorHandler } from "./middleware/error-handler";
import { notFoundHandler } from "./middleware/not-found";
import { requestIdMiddleware } from "./middleware/request-id";
import { BookingController } from "./modules/bookings/booking.controller";
import { BookingOutboxDispatcher } from "./modules/bookings/booking-outbox.dispatcher";
import { createBookingRouter } from "./modules/bookings/booking.routes";
import { BookingsService } from "./modules/bookings/booking.service";

export type BookingServiceDependencies = {
  db: BookingDatabaseClient;
  publisher?: MessagePublisher;
  repository?: BookingRepository;
  outboxDispatcher?: BookingOutboxDispatcher;
  service?: BookingsService;
  controller?: BookingController;
};

export async function createBookingApp({
  db,
  publisher = new InMemoryMessagePublisher(),
  repository,
  outboxDispatcher,
  service,
  controller
}: BookingServiceDependencies): Promise<Express> {
  const app = express();
  const httpLogger = createHttpLogger("booking-service");
  const bookingRepository = repository ?? new PrismaBookingRepository(db);
  const bookingOutboxDispatcher = outboxDispatcher ?? new BookingOutboxDispatcher(bookingRepository, publisher);
  const bookingService = service ?? new BookingsService(bookingRepository, bookingOutboxDispatcher);
  const bookingController = controller ?? new BookingController(bookingService);

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

  app.use("/bookings", createBookingRouter(bookingController));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
