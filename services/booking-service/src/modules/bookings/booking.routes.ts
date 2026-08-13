import { Router } from "express";
import { BookingController } from "./booking.controller";

export function createBookingRouter(controller: BookingController): Router {
  const router = Router();

  router.post("/", controller.createBooking);
  router.get("/users/:userId/bookings", controller.listBookingsForUser);
  router.get("/:id", controller.getBookingById);
  router.post("/:id/cancel", controller.cancelBooking);

  return router;
}
