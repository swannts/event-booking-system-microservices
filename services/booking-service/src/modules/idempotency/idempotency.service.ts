import type { BookingDto } from "../bookings/booking.repository";
import type { IdempotencyRepository } from "./idempotency.repository";

export class IdempotencyService {
  constructor(private readonly repository: IdempotencyRepository) {}

  async getExistingResponse(key: string): Promise<BookingDto | null> {
    const response = await this.repository.findResponse(key);
    return response ? (response as BookingDto) : null;
  }

  async storeResponse(key: string, bookingId: string, requestFingerprint: string, response: BookingDto): Promise<void> {
    await this.repository.storeResponse(key, bookingId, requestFingerprint, response);
  }
}
