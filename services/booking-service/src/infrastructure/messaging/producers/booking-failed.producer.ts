import { Topics, type MessageEnvelope, type BookingFailedPayload } from "@event-booking/contracts";
import type { MessagePublisher } from "../message-publisher";

export async function publishBookingFailed(
  publisher: MessagePublisher,
  message: MessageEnvelope<BookingFailedPayload>
): Promise<void> {
  await publisher.publish(Topics.BOOKING_FAILED, message);
}
