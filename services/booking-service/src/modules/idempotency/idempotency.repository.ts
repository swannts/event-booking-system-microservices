import type { BookingRepository } from "../bookings/booking.repository";

export interface IdempotencyRepository {
  findResponse(key: string): Promise<unknown | null>;
  storeResponse(key: string, bookingId: string, requestFingerprint: string, response: unknown): Promise<void>;
}

export class BookingIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly repository: BookingRepository) {}

  async findResponse(key: string): Promise<unknown | null> {
    return this.repository.findIdempotencyResponse(key);
  }

  async storeResponse(key: string, bookingId: string, requestFingerprint: string, response: unknown): Promise<void> {
    await this.repository.storeIdempotencyKey({
      key,
      bookingId,
      requestFingerprint,
      response
    });
  }
}
