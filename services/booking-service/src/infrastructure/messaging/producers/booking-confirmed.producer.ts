import { Topics, type MessageEnvelope, type BookingConfirmedPayload } from "@event-booking/contracts";
import type { MessagePublisher } from "../message-publisher";

export async function publishBookingConfirmed(
  publisher: MessagePublisher,
  message: MessageEnvelope<BookingConfirmedPayload>
): Promise<void> {
  await publisher.publish(Topics.BOOKING_CONFIRMED, message);
}
