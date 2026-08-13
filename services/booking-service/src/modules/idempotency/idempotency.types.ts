export type IdempotencyRecord = {
  key: string;
  bookingId: string;
  response: unknown;
  createdAt: string;
};
