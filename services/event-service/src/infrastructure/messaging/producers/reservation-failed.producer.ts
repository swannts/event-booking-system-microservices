import {
  Topics,
  type MessageEnvelope,
  type SeatReservationFailedPayload
} from "@event-booking/contracts";
import type { MessagePublisher } from "../message-publisher";

export async function publishReservationFailed(
  publisher: MessagePublisher,
  message: MessageEnvelope<SeatReservationFailedPayload>
): Promise<void> {
  await publisher.publish(Topics.SEAT_RESERVATION_FAILED, message);
}
