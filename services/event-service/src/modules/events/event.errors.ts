export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const EventErrors = {
  notFound: () => new AppError("EVENT_NOT_FOUND", "Event not found", 404),
  capacityBelowReservedSeats: () =>
    new AppError(
      "CAPACITY_BELOW_RESERVED_SEATS",
      "Event capacity cannot be lower than the number of reserved seats",
      409
    ),
  hasReservations: () => new AppError("EVENT_HAS_RESERVATIONS", "Events with reserved seats cannot be deleted", 409),
  validation: (message: string) => new AppError("VALIDATION_ERROR", message, 400)
} as const;
