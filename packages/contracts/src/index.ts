import { z } from "zod";

export const Topics = {
  RESERVE_SEATS: "booking.reserve-seats",
  SEATS_RESERVED: "event.seats-reserved",
  SEAT_RESERVATION_FAILED: "event.seat-reservation-failed",
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

export type BookingStatus = "PENDING" | "CONFIRMED" | "FAILED" | "CANCELLED" | "EXPIRED";

export type ReserveSeatsPayload = {
  bookingId: string;
  eventId: string;
  userId: string;
  quantity: number;
};

export type BookingCreatedPayload = {
  bookingId: string;
  userId: string;
  eventId: string;
  quantity: number;
  status: BookingStatus;
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

export type BookingCancelledPayload = {
  bookingId: string;
  eventId: string;
  quantity: number;
};

export type BookingConfirmedPayload = {
  bookingId: string;
  eventId: string;
  quantity: number;
};

export type BookingFailedPayload = {
  bookingId: string;
  eventId: string;
  reason: "INSUFFICIENT_SEATS" | "EVENT_NOT_FOUND";
};

export type TopicPayloadMap = {
  [Topics.RESERVE_SEATS]: ReserveSeatsPayload;
  [Topics.SEATS_RESERVED]: SeatsReservedPayload;
  [Topics.SEAT_RESERVATION_FAILED]: SeatReservationFailedPayload;
  [Topics.BOOKING_CONFIRMED]: BookingConfirmedPayload;
  [Topics.BOOKING_FAILED]: BookingFailedPayload;
  [Topics.BOOKING_CANCELLED]: BookingCancelledPayload;
};

export type MessageForTopic<TTopic extends Topic> = MessageEnvelope<TopicPayloadMap[TTopic]>;

const uuid = z.uuid();
const quantity = z.number().int().positive();
const bookingEventQuantitySchema = z.object({
  bookingId: uuid,
  eventId: uuid,
  quantity
});
const failureSchema = z.object({
  bookingId: uuid,
  eventId: uuid,
  reason: z.enum(["INSUFFICIENT_SEATS", "EVENT_NOT_FOUND"])
});

export const topicPayloadSchemas = {
  [Topics.RESERVE_SEATS]: z.object({
    bookingId: uuid,
    eventId: uuid,
    userId: uuid,
    quantity
  }),
  [Topics.SEATS_RESERVED]: bookingEventQuantitySchema,
  [Topics.SEAT_RESERVATION_FAILED]: failureSchema,
  [Topics.BOOKING_CONFIRMED]: bookingEventQuantitySchema,
  [Topics.BOOKING_FAILED]: failureSchema,
  [Topics.BOOKING_CANCELLED]: bookingEventQuantitySchema
} satisfies { [TTopic in Topic]: z.ZodType<TopicPayloadMap[TTopic]> };

export function messageEnvelopeSchema<TPayload>(payloadSchema: z.ZodType<TPayload>) {
  return z.object({
    eventId: uuid.optional(),
    messageId: uuid,
    correlationId: uuid,
    timestamp: z.iso.datetime({ offset: true }),
    version: z.literal(1),
    payload: payloadSchema
  });
}

export function parseMessageEnvelope<TTopic extends Topic>(topic: TTopic, value: unknown): MessageForTopic<TTopic> {
  const payloadSchema = topicPayloadSchemas[topic] as unknown as z.ZodType<TopicPayloadMap[TTopic]>;
  return messageEnvelopeSchema(payloadSchema).parse(value);
}
export * from "./pagination";
