import { Topics, type MessageEnvelope, type ReserveSeatsPayload } from "@event-booking/contracts";
import type { MessagePublisher } from "../message-publisher";

export async function publishReserveSeats(
  publisher: MessagePublisher,
  message: MessageEnvelope<ReserveSeatsPayload>
): Promise<void> {
  await publisher.publish(Topics.RESERVE_SEATS, message);
}
