import express, { type Express, type RequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import type { Pool } from "pg";
import { createHttpLogger } from "@event-booking/logger";
import { requestIdMiddleware } from "./middleware/request-id";
import { errorHandler } from "./middleware/error-handler";
import { createUserRouter } from "./modules/users/user.routes";
import { UsersService } from "./modules/users/user.service";
import { PostgresUserRepository, ensureUsersTable } from "./infrastructure/database/user-repository";

export type UserServiceDependencies = {
  db: Pool;
};

export async function createUserApp({ db }: UserServiceDependencies): Promise<Express> {
  await ensureUsersTable(db);

  const app = express();
  const repository = new PostgresUserRepository(db);
  const service = new UsersService(repository);
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
    await db.query("SELECT 1");
    res.json({ status: "ok" });
  });

  app.use("/users", createUserRouter(service));
  app.use(errorHandler);

  return app;
}
