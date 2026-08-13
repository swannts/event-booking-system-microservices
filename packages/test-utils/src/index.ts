import { randomUUID } from "crypto";

export function createRequestId() {
  return randomUUID();
}
