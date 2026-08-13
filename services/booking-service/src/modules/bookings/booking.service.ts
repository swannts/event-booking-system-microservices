import { randomUUID } from "crypto";
import {
  Topics,
  type BookingCancelledPayload,
  type MessageEnvelope,
  type ReserveSeatsPayload
} from "@event-booking/contracts";
import type { BookingDto, PostgresBookingRepository } from "../../infrastructure/database/booking-repository";
import type { MessagePublisher } from "../../infrastructure/messaging/message-publisher";
import { BookingErrors, AppError } from "./booking-errors";

export class BookingsService {
  constructor(
    private readonly repository: PostgresBookingRepository,
    private readonly publisher: MessagePublisher
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
        return existing as BookingDto;
      }
    }

    const booking = await this.repository.create({
      id: randomUUID(),
      userId: input.userId,
      eventId: input.eventId,
      quantity: input.quantity,
      status: "PENDING",
      idempotencyKey: input.idempotencyKey ?? null
    });

    if (input.idempotencyKey) {
      await this.repository.storeIdempotencyKey({
        key: input.idempotencyKey,
        bookingId: booking.id,
        response: booking
      });
    }

    const reserveSeatsMessage: MessageEnvelope<ReserveSeatsPayload> = {
      messageId: randomUUID(),
      correlationId: booking.id,
      timestamp: new Date().toISOString(),
      version: 1,
      payload: {
        bookingId: booking.id,
        eventId: booking.eventId,
        userId: booking.userId,
        quantity: booking.quantity
      }
    };

    await this.publisher.publish(Topics.RESERVE_SEATS, reserveSeatsMessage);
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
      throw BookingErrors.invalidStatus();
    }

    const cancelled = await this.repository.updateStatus(id, "CANCELLED");
    if (!cancelled) {
      throw BookingErrors.notFound();
    }

    const cancelMessage: MessageEnvelope<BookingCancelledPayload> = {
      messageId: randomUUID(),
      correlationId: booking.id,
      timestamp: new Date().toISOString(),
      version: 1,
      payload: {
        bookingId: booking.id,
        eventId: booking.eventId,
        quantity: booking.quantity
      }
    };

    await this.publisher.publish(Topics.BOOKING_CANCELLED, cancelMessage);
    return cancelled;
  }

  async markConfirmed(id: string): Promise<BookingDto> {
    const booking = await this.repository.updateStatus(id, "CONFIRMED");
    if (!booking) {
      throw BookingErrors.notFound();
    }
    return booking;
  }

  async markFailed(id: string): Promise<BookingDto> {
    const booking = await this.repository.updateStatus(id, "FAILED");
    if (!booking) {
      throw BookingErrors.notFound();
    }
    return booking;
  }
}
