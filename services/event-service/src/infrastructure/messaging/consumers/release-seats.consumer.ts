import type { BookingCancelledPayload, MessageEnvelope } from "@event-booking/contracts";
import { InventoryService } from "../../../modules/inventory/inventory.service";

export class ReleaseSeatsConsumer {
  constructor(private readonly service: InventoryService) {}

  async handle(message: MessageEnvelope<BookingCancelledPayload>): Promise<void> {
    await this.service.releaseSeats(message);
  }
}
