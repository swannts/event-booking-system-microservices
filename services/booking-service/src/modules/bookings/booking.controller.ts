import type { NextFunction, Request, Response } from "express";
import {
  createBookingSchema,
  bookingIdParamSchema,
  userBookingsParamSchema,
  paginationQuerySchema
} from "./booking.schema";
import { BookingsService } from "./booking.service";

export class BookingController {
  constructor(private readonly service: BookingsService) {}

  createBooking = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = createBookingSchema.parse(req.body);
      const idempotencyKey = req.header("Idempotency-Key");
      const booking = await this.service.createBooking({ ...input, idempotencyKey });
      res.status(201).json(booking);
    } catch (error) {
      next(error);
    }
  };

  getBookingById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = bookingIdParamSchema.parse(req.params);
      res.json(await this.service.getBookingById(id));
    } catch (error) {
      next(error);
    }
  };

  listBookingsForUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = userBookingsParamSchema.parse(req.params);
      res.json(await this.service.listBookingsForUser(userId, paginationQuerySchema.parse(req.query)));
    } catch (error) {
      next(error);
    }
  };

  cancelBooking = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = bookingIdParamSchema.parse(req.params);
      res.json(await this.service.cancelBooking(id));
    } catch (error) {
      next(error);
    }
  };
}
