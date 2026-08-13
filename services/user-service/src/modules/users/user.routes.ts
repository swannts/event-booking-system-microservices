import { Router } from "express";
import type { UserController } from "./user.controller";

export function createUserRouter(controller: UserController): Router {
  const router = Router();

  router.post("/", controller.createUser);
  router.get("/", controller.listUsers);
  router.get("/:id", controller.getUserById);

  return router;
}
