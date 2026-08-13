export class InventoryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "InventoryError";
  }
}

export const InventoryErrors = {
  insufficientSeats: () => new InventoryError("INSUFFICIENT_SEATS", "Insufficient seats", 409),
  eventNotFound: () => new InventoryError("EVENT_NOT_FOUND", "Event not found", 404),
  invalidQuantity: () => new InventoryError("INVALID_QUANTITY", "Quantity must be greater than zero", 400)
} as const;
