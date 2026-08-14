export type CreateUserPayload = {
  name: string;
  email: string;
};

export type UserResponse = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
};

export class UserClientDriver {
  constructor(private readonly baseUrl = "http://127.0.0.1:3000") {}

  async createUser(payload: CreateUserPayload): Promise<UserResponse> {
    const res = await fetch(`${this.baseUrl}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to create user (${res.status}): ${errText}`);
    }

    return await res.json();
  }

  async getUserById(id: string): Promise<UserResponse> {
    const res = await fetch(`${this.baseUrl}/users/${id}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch user (${res.status})`);
    }
    return await res.json();
  }

  async listUsers(): Promise<UserResponse[]> {
    const res = await fetch(`${this.baseUrl}/users`);
    if (!res.ok) {
      throw new Error(`Failed to list users (${res.status})`);
    }
    return await res.json();
  }
}
