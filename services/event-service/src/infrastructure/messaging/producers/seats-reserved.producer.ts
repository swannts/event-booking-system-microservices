import { Topics, type MessageEnvelope, type SeatsReservedPayload } from "@event-booking/contracts";
import type { MessagePublisher } from "../message-publisher";

export async function publishSeatsReserved(
  publisher: MessagePublisher,
  message: MessageEnvelope<SeatsReservedPayload>
): Promise<void> {
  await publisher.publish(Topics.SEATS_RESERVED, message);
}
