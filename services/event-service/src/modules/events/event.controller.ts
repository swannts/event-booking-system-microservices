import type { NextFunction, Request, Response } from "express";
import { createEventSchema, eventIdParamSchema, updateEventSchema } from "./event.schema";
import { EventsService } from "./event.service";
import { sendCreated, sendJson, sendNoContent } from "../../utils/response";
import { paginationQuerySchema } from "@event-booking/contracts";

export class EventController {
  constructor(private readonly service: EventsService) {}

  createEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = createEventSchema.parse(req.body);
      const event = await this.service.createEvent(input);
      sendCreated(res, event);
    } catch (error) {
      next(error);
    }
  };

  listEvents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      sendJson(res, 200, await this.service.listEvents(paginationQuerySchema.parse(req.query)));
    } catch (error) {
      next(error);
    }
  };

  getEventById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = eventIdParamSchema.parse(req.params);
      sendJson(res, 200, await this.service.getEventById(id));
    } catch (error) {
      next(error);
    }
  };

  updateEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = eventIdParamSchema.parse(req.params);
      const input = updateEventSchema.parse(req.body);
      sendJson(res, 200, await this.service.updateEvent(id, input));
    } catch (error) {
      next(error);
    }
  };

  deleteEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = eventIdParamSchema.parse(req.params);
      await this.service.deleteEvent(id);
      sendNoContent(res);
    } catch (error) {
      next(error);
    }
  };
}
