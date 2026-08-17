export type IdempotencyRecord = {
  key: string;
  bookingId: string;
  requestFingerprint: string;
  response: unknown;
  createdAt: string;
};
