import { z } from "zod";

export const createEventSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  date: z.string().datetime("Date must be valid"),
  totalSeats: z.number().int().positive("Total seats must be greater than zero")
});

export const updateEventSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  date: z.string().datetime("Date must be valid"),
  totalSeats: z.number().int().positive("Total seats must be greater than zero")
});

export const eventIdParamSchema = z.object({
  id: z.string().uuid("Invalid event id")
});

export const reserveSeatsSchema = z.object({
  eventId: z.string().uuid(),
  quantity: z.number().int().positive()
});
