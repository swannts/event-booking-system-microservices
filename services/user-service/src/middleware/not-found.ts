import type { Request, Response } from "express";

export function notFoundHandler(req: Request, res: Response): Response {
  return res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      requestId: (req.headers["x-request-id"] as string | undefined) ?? undefined
    }
  });
}
