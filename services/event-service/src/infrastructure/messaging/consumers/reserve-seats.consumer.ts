import type { MessageEnvelope, ReserveSeatsPayload } from "@event-booking/contracts";
import type { InventoryService } from "../../../modules/inventory/inventory.service";

export class BookingReservationConsumer {
  constructor(private readonly service: InventoryService) {}

  async handle(message: MessageEnvelope<ReserveSeatsPayload>): Promise<void> {
    await this.service.reserveSeats(message);
  }
}
