import { Topics, type MessageEnvelope, type BookingCancelledPayload } from "@event-booking/contracts";
import type { MessagePublisher } from "../message-publisher";

export async function publishReleaseSeats(
  publisher: MessagePublisher,
  message: MessageEnvelope<BookingCancelledPayload>
): Promise<void> {
  await publisher.publish(Topics.RELEASE_SEATS, message);
}
