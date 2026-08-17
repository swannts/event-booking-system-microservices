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
import { Prisma } from "../generated/prisma";
import { httpMetrics, metricsHandler, readinessHandler } from "@event-booking/observability";

export type BookingServiceDependencies = {
  db: BookingDatabaseClient;
  publisher?: MessagePublisher;
  repository?: BookingRepository;
  outboxDispatcher?: BookingOutboxDispatcher;
  service?: BookingsService;
  controller?: BookingController;
  kafkaReady?: () => boolean;
};

export async function createBookingApp({
  db,
  publisher = new InMemoryMessagePublisher(),
  repository,
  outboxDispatcher,
  service,
  controller,
  kafkaReady = () => true
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
  app.use(httpMetrics("booking-service"));

  app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
  app.get(
    "/health/ready",
    readinessHandler({
      database: async () => {
        await db.$queryRaw(Prisma.sql`SELECT 1`);
      },
      outbox: async () => {
        await db.$queryRaw(Prisma.sql`SELECT 1 FROM booking_outbox_events LIMIT 1`);
      },
      kafka: async () => {
        if (!kafkaReady()) throw new Error("Kafka consumer is not running");
      }
    })
  );
  app.get("/metrics", metricsHandler);

  app.use("/bookings", createBookingRouter(bookingController));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
