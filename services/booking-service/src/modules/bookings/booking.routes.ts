import { Router } from "express";
import { createBookingSchema, bookingIdParamSchema, userBookingsParamSchema } from "./booking.schema";
import { BookingsService } from "./booking.service";

export function createBookingRouter(service: BookingsService): Router {
  const router = Router();

  router.post("/", async (req, res, next) => {
    try {
      const input = createBookingSchema.parse(req.body);
      const idempotencyKey = req.header("Idempotency-Key");
      const booking = await service.createBooking({ ...input, idempotencyKey });
      res.status(201).json(booking);
    } catch (error) {
      next(error);
    }
  });

  router.get("/users/:userId/bookings", async (req, res, next) => {
    try {
      const { userId } = userBookingsParamSchema.parse(req.params);
      res.json(await service.listBookingsForUser(userId));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const { id } = bookingIdParamSchema.parse(req.params);
      res.json(await service.getBookingById(id));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/cancel", async (req, res, next) => {
    try {
      const { id } = bookingIdParamSchema.parse(req.params);
      res.json(await service.cancelBooking(id));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
