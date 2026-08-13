import express, { type Express, type RequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { createHttpLogger } from "@event-booking/logger";
import { requestIdMiddleware } from "./middleware/request-id";
import { errorHandler } from "./middleware/error-handler";
import { createUserRouter } from "./modules/users/user.routes";
import { UsersService } from "./modules/users/user.service";
import { PrismaUserRepository } from "./modules/users/user.repository";
import { UserController } from "./modules/users/user.controller";
import { ensureUsersTable, type UserDatabase } from "./config/database";
import { notFoundHandler } from "./middleware/not-found";

export type UserServiceDependencies = {
  db: UserDatabase;
};

export async function createUserApp({ db }: UserServiceDependencies): Promise<Express> {
  await ensureUsersTable(db);

  const app = express();
  const repository = new PrismaUserRepository(db);
  const service = new UsersService(repository);
  const controller = new UserController(service);
  const httpLogger = createHttpLogger("user-service");

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

  app.get("/health/live", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/health/ready", async (_req, res) => {
    await db.$connect();
    res.json({ status: "ok" });
  });

  app.use("/users", createUserRouter(controller));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
