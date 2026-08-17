export type CreateEventPayload = {
  title: string;
  totalSeats: number;
  date: string;
};

export type EventResponse = {
  id: string;
  title: string;
  totalSeats: number;
  availableSeats: number;
  date: string;
  createdAt: string;
  updatedAt: string;
};

export class EventClientDriver {
  constructor(private readonly baseUrl = "http://127.0.0.1:3001") {}

  async createEvent(payload: CreateEventPayload): Promise<EventResponse> {
    const res = await fetch(`${this.baseUrl}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to create event (${res.status}): ${errText}`);
    }

    return await res.json();
  }

  async getEventById(id: string): Promise<EventResponse> {
    const res = await fetch(`${this.baseUrl}/events/${id}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch event (${res.status})`);
    }
    return await res.json();
  }

  async listEvents(): Promise<EventResponse[]> {
    const res = await fetch(`${this.baseUrl}/events`);
    if (!res.ok) {
      throw new Error(`Failed to list events (${res.status})`);
    }
    return await res.json();
  }

  async requestDeletion(id: string): Promise<{ response: Response; data: unknown }> {
    const response = await fetch(`${this.baseUrl}/events/${id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }
}
