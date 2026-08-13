export const Topics = {
  RESERVE_SEATS: "booking.reserve-seats",
  SEATS_RESERVED: "event.seats-reserved",
  SEAT_RESERVATION_FAILED: "event.seat-reservation-failed",
  RELEASE_SEATS: "booking.release-seats",
  BOOKING_CONFIRMED: "booking.confirmed",
  BOOKING_FAILED: "booking.failed",
  BOOKING_CANCELLED: "booking.cancelled"
} as const;

export type Topic = (typeof Topics)[keyof typeof Topics];

export type MessageEnvelope<TPayload> = {
  eventId?: string;
  messageId: string;
  correlationId: string;
  timestamp: string;
  version: number;
  payload: TPayload;
};

export type BookingStatus =
  | "PENDING"
  | "CONFIRMED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";

export type ReserveSeatsPayload = {
  bookingId: string;
  eventId: string;
  userId: string;
  quantity: number;
};

export type SeatsReservedPayload = {
  bookingId: string;
  eventId: string;
  quantity: number;
};

export type SeatReservationFailedPayload = {
  bookingId: string;
  eventId: string;
  reason: "INSUFFICIENT_SEATS" | "EVENT_NOT_FOUND";
};
