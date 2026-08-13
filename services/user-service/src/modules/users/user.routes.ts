import { Router } from "express";
import { createUserSchema, userIdParamSchema } from "./user.schema";
import { UsersService } from "./user.service";

export function createUserRouter(service: UsersService): Router {
  const router = Router();

  router.post("/", async (req, res, next) => {
    try {
      const input = createUserSchema.parse(req.body);
      const user = await service.createUser(input);
      res.status(201).json(user);
    } catch (error) {
      next(error);
    }
  });

  router.get("/", async (_req, res, next) => {
    try {
      const users = await service.listUsers();
      res.json(users);
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const { id } = userIdParamSchema.parse(req.params);
      const user = await service.getUserById(id);
      res.json(user);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
