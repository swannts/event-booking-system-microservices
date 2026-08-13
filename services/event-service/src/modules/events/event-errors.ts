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
  validation: (message: string) => new AppError("VALIDATION_ERROR", message, 400)
} as const;
