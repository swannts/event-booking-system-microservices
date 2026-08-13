import type { Response } from "express";

export function sendJson<T>(res: Response, statusCode: number, body: T): Response {
  return res.status(statusCode).json(body);
}

export function sendCreated<T>(res: Response, body: T): Response {
  return sendJson(res, 201, body);
}

export function sendOk<T>(res: Response, body: T): Response {
  return sendJson(res, 200, body);
}
