export type CreateBookingPayload = {
  userId: string;
  eventId: string;
  quantity: number;
};

export type BookingResponse = {
  id: string;
  userId: string;
  eventId: string;
  quantity: number;
  status: "PENDING" | "CONFIRMED" | "FAILED" | "CANCELLED" | "EXPIRED";
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
};

export class BookingClientDriver {
  constructor(private readonly baseUrl = "http://127.0.0.1:3002") {}

  async createBooking(payload: CreateBookingPayload, idempotencyKey?: string): Promise<{ response: Response; data: any }> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    const response = await fetch(`${this.baseUrl}/bookings`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  async getBookingById(id: string): Promise<BookingResponse> {
    const res = await fetch(`${this.baseUrl}/bookings/${id}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch booking (${res.status})`);
    }
    return await res.json();
  }

  async cancelBooking(id: string): Promise<BookingResponse> {
    const res = await fetch(`${this.baseUrl}/bookings/${id}/cancel`, {
      method: "POST"
    });
    if (!res.ok) {
      throw new Error(`Failed to cancel booking (${res.status})`);
    }
    return await res.json();
  }
}
