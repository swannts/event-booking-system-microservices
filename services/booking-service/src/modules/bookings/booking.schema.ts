import { z } from "zod";

export const createBookingSchema = z.object({
  userId: z.string().uuid("Invalid user id"),
  eventId: z.string().uuid("Invalid event id"),
  quantity: z.number().int().positive("Quantity must be greater than zero")
});

export const bookingIdParamSchema = z.object({
  id: z.string().uuid("Invalid booking id")
});

export const userBookingsParamSchema = z.object({
  userId: z.string().uuid("Invalid user id")
});

export const cancelBookingSchema = z.object({
  id: z.string().uuid("Invalid booking id")
});
