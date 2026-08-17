export type BookingRequestIdentity = {
  userId: string;
  eventId: string;
  quantity: number;
};

export function createBookingRequestFingerprint(input: BookingRequestIdentity): string {
  return [
    "v1",
    input.userId.trim().toLowerCase(),
    input.eventId.trim().toLowerCase(),
    input.quantity.toString(10)
  ].join(":");
}
