import { randomUUID } from "crypto";
import {
  Topics,
  type BookingCancelledPayload,
  type MessageEnvelope,
  type ReserveSeatsPayload
} from "@event-booking/contracts";
import { createLogger, type AppLogger } from "@event-booking/logger";
import type { BookingDto, BookingRepository } from "../../infrastructure/database/booking-repository";
import { BookingErrors } from "./booking-errors";
import type { BookingOutboxDispatcher } from "./booking-outbox.dispatcher";

export class BookingsService {
  constructor(
    private readonly repository: BookingRepository,
    private readonly outboxDispatcher: BookingOutboxDispatcher,
    private readonly logger: AppLogger = createLogger("booking-service")
  ) {}

  async createBooking(input: {
    userId: string;
    eventId: string;
    quantity: number;
    idempotencyKey?: string | null;
  }): Promise<BookingDto> {
    if (input.idempotencyKey) {
      const existing = await this.repository.findIdempotencyResponse(input.idempotencyKey);
      if (existing) {
        this.logger.info(
          {
            bookingId: (existing as BookingDto).id,
            eventId: (existing as BookingDto).eventId,
            idempotencyKey: input.idempotencyKey
          },
          "Booking request replayed via idempotency key"
        );
        return existing as BookingDto;
      }
    }

    const bookingId = randomUUID();
    const booking = await this.repository.createBookingWithOutbox(
      {
        id: bookingId,
        userId: input.userId,
        eventId: input.eventId,
        quantity: input.quantity,
        status: "PENDING",
        idempotencyKey: input.idempotencyKey ?? null
      },
      {
        id: randomUUID(),
        topic: Topics.RESERVE_SEATS,
        message: {
          messageId: randomUUID(),
          correlationId: bookingId,
          timestamp: new Date().toISOString(),
          version: 1,
          eventId: input.eventId,
          payload: {
            bookingId,
            eventId: input.eventId,
            userId: input.userId,
            quantity: input.quantity
          }
        } satisfies MessageEnvelope<ReserveSeatsPayload>
      }
    );

    this.logger.info(
      {
        bookingId: booking.id,
        eventId: booking.eventId,
        userId: booking.userId,
        quantity: booking.quantity,
        idempotencyKey: input.idempotencyKey ?? undefined
      },
      "Booking created and outbox event queued"
    );
    await this.outboxDispatcher.dispatchPending();
    return booking;
  }

  async getBookingById(id: string): Promise<BookingDto> {
    const booking = await this.repository.findById(id);
    if (!booking) {
      throw BookingErrors.notFound();
    }
    return booking;
  }

  async listBookingsForUser(userId: string): Promise<BookingDto[]> {
    return this.repository.findByUserId(userId);
  }

  async cancelBooking(id: string): Promise<BookingDto> {
    const booking = await this.getBookingById(id);
    if (booking.status !== "CONFIRMED") {
      this.logger.warn(
        {
          bookingId: booking.id,
          status: booking.status
        },
        "Rejected booking cancellation for non-confirmed booking"
      );
      throw BookingErrors.invalidStatus();
    }

    const cancelled = await this.repository.cancelBookingWithOutbox({
      id,
      outbox: {
        id: randomUUID(),
        topic: Topics.BOOKING_CANCELLED,
        message: {
          messageId: randomUUID(),
          correlationId: booking.id,
          timestamp: new Date().toISOString(),
          version: 1,
          eventId: booking.eventId,
          payload: {
            bookingId: booking.id,
            eventId: booking.eventId,
            quantity: booking.quantity
          }
        } satisfies MessageEnvelope<BookingCancelledPayload>
      }
    });
    if (!cancelled) {
      throw BookingErrors.notFound();
    }
    this.logger.info(
      {
        bookingId: cancelled.id,
        eventId: cancelled.eventId,
        quantity: cancelled.quantity
      },
      "Booking cancelled and cancellation outbox event queued"
    );
    await this.outboxDispatcher.dispatchPending();
    return cancelled;
  }

  async markConfirmed(id: string): Promise<BookingDto> {
    const booking = await this.repository.updateStatus(id, "CONFIRMED");
    if (!booking) {
      throw BookingErrors.notFound();
    }
    this.logger.info({ bookingId: booking.id, eventId: booking.eventId }, "Booking confirmed");
    return booking;
  }

  async markFailed(id: string): Promise<BookingDto> {
    const booking = await this.repository.updateStatus(id, "FAILED");
    if (!booking) {
      throw BookingErrors.notFound();
    }
    this.logger.warn({ bookingId: booking.id, eventId: booking.eventId }, "Booking failed");
    return booking;
  }
}
