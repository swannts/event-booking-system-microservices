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

  async createBooking(
    payload: CreateBookingPayload,
    idempotencyKey?: string
  ): Promise<{ response: Response; data: BookingResponse }> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    const response = await fetch(`${this.baseUrl}/bookings`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    const data = (await response.json().catch(() => ({}))) as BookingResponse;
    return { response, data };
  }

  async getBookingById(id: string): Promise<BookingResponse> {
    const res = await fetch(`${this.baseUrl}/bookings/${id}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch booking (${res.status})`);
    }
    return await res.json();
  }

  async listBookingsForUser(userId: string): Promise<BookingResponse[]> {
    const res = await fetch(`${this.baseUrl}/bookings/users/${userId}/bookings`);
    if (!res.ok) {
      throw new Error(`Failed to list bookings (${res.status})`);
    }
    return await res.json();
  }

  async cancelBooking(id: string): Promise<BookingResponse> {
    const { response, data } = await this.requestCancellation(id);
    if (!response.ok) {
      throw new Error(`Failed to cancel booking (${response.status})`);
    }
    return data as BookingResponse;
  }

  async requestCancellation(id: string): Promise<{ response: Response; data: unknown }> {
    const response = await fetch(`${this.baseUrl}/bookings/${id}/cancel`, {
      method: "POST"
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }
}
