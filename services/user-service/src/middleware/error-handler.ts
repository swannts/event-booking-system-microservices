import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../modules/users/user-errors";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = (req.header("x-request-id") as string | undefined) ?? undefined;

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: err.issues[0]?.message ?? "Validation failed",
        requestId
      }
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        requestId
      }
    });
  }

  return res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      requestId
    }
  });
}
