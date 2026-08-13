import type { Request } from "express";
import type { BookingDto } from "../../infrastructure/database/booking-repository";

export type CreateBookingInput = {
  userId: string;
  eventId: string;
  quantity: number;
  idempotencyKey?: string | null;
};

export type BookingIdParams = {
  id: string;
};

export type UserBookingsParams = {
  userId: string;
};

export type BookingResponse = BookingDto;

export type BookingRequestWithIdempotency = Request & {
  header(name: "Idempotency-Key"): string | undefined;
};
