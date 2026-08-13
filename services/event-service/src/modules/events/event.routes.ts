import { Router } from "express";
import { createEventSchema, eventIdParamSchema, updateEventSchema } from "./event.schema";
import { EventsService } from "./event.service";

export function createEventRouter(service: EventsService): Router {
  const router = Router();

  router.post("/", async (req, res, next) => {
    try {
      const input = createEventSchema.parse(req.body);
      const event = await service.createEvent(input);
      res.status(201).json(event);
    } catch (error) {
      next(error);
    }
  });

  router.get("/", async (_req, res, next) => {
    try {
      res.json(await service.listEvents());
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const { id } = eventIdParamSchema.parse(req.params);
      res.json(await service.getEventById(id));
    } catch (error) {
      next(error);
    }
  });

  router.put("/:id", async (req, res, next) => {
    try {
      const { id } = eventIdParamSchema.parse(req.params);
      const input = updateEventSchema.parse(req.body);
      res.json(await service.updateEvent(id, input));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      const { id } = eventIdParamSchema.parse(req.params);
      await service.deleteEvent(id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
