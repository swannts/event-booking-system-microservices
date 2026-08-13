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

export const BookingErrors = {
  notFound: () => new AppError("BOOKING_NOT_FOUND", "Booking not found", 404),
  invalidStatus: () => new AppError("INVALID_BOOKING_STATUS", "Invalid booking status", 409),
  validation: (message: string) => new AppError("VALIDATION_ERROR", message, 400)
} as const;
