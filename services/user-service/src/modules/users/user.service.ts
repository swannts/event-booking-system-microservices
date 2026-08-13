import { randomUUID } from "crypto";
import { UserErrors } from "./user-errors";
import type { UserDto, UserRepository } from "../../infrastructure/database/user-repository";

export class UsersService {
  constructor(private readonly repository: UserRepository) {}

  async createUser(input: { name: string; email: string }): Promise<UserDto> {
    const existing = await this.repository.findByEmail(input.email);
    if (existing) {
      throw UserErrors.duplicateEmail();
    }

    return this.repository.create({
      id: randomUUID(),
      name: input.name,
      email: input.email
    });
  }

  async getUserById(id: string): Promise<UserDto> {
    const user = await this.repository.findById(id);
    if (!user) {
      throw UserErrors.notFound();
    }

    return user;
  }

  async listUsers(): Promise<UserDto[]> {
    return this.repository.findAll();
  }
}
