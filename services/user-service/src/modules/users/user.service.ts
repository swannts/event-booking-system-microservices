import { randomUUID } from "crypto";
import { Prisma } from "../../../generated/prisma";
import { UserErrors } from "./user.errors";
import type { UserDto, UserRepository } from "./user.types";

export class UsersService {
  constructor(private readonly repository: UserRepository) {}

  async createUser(input: { name: string; email: string }): Promise<UserDto> {
    const email = input.email.trim().toLowerCase();
    try {
      const existing = await this.repository.findByEmail(email);
      if (existing) {
        throw UserErrors.duplicateEmail();
      }

      return await this.repository.create({
        id: randomUUID(),
        name: input.name,
        email
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw UserErrors.duplicateEmail();
      }

      throw error;
    }
  }

  async getUserById(id: string): Promise<UserDto> {
    const user = await this.repository.findById(id);
    if (!user) {
      throw UserErrors.notFound();
    }

    return user;
  }

  async listUsers(pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 }): Promise<UserDto[]> {
    return this.repository.findAll(pagination);
  }
}
