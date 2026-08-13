import type { NextFunction, Request, Response } from "express";

export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
  const idempotencyKey = req.header("Idempotency-Key");
  if (idempotencyKey) {
    req.headers["idempotency-key"] = idempotencyKey;
  }

  next();
}
