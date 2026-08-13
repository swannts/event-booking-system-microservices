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

export const UserErrors = {
  duplicateEmail: () => new AppError("DUPLICATE_EMAIL", "Email already exists", 409),
  notFound: () => new AppError("USER_NOT_FOUND", "User not found", 404),
  validation: (message: string) => new AppError("VALIDATION_ERROR", message, 400)
} as const;
