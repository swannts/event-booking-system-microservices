import { Router } from "express";
import type { EventController } from "./event.controller";

export function createEventRouter(controller: EventController): Router {
  const router = Router();

  router.post("/", controller.createEvent);
  router.get("/", controller.listEvents);
  router.get("/:id", controller.getEventById);
  router.put("/:id", controller.updateEvent);
  router.delete("/:id", controller.deleteEvent);

  return router;
}
