import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import type { Pool } from "pg";
import { createLogger } from "@event-booking/logger";
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
  const logger = createLogger("user-service");
  const repository = new PostgresUserRepository(db);
  const service = new UsersService(repository);

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(requestIdMiddleware);
  app.use(pinoHttp({ logger }));

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
