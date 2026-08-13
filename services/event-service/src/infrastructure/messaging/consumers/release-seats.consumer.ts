import type { MessageEnvelope, BookingCancelledPayload } from "@event-booking/contracts";

export class ReleaseSeatsConsumer {
  async handle(_message: MessageEnvelope<BookingCancelledPayload>): Promise<void> {
    return;
  }
}
