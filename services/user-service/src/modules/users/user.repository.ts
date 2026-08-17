import type { PrismaClient, User as UserModel } from "../../../generated/prisma";
import type { CreateUserInput, UserDto, UserRepository } from "./user.types";

export type { CreateUserInput, UserDto, UserRepository };

function mapRow(row: UserModel): UserDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: { id: string; name: string; email: string }): Promise<UserDto> {
    const user = await this.db.user.create({
      data: {
        id: input.id,
        name: input.name,
        email: input.email.trim().toLowerCase()
      }
    });

    return mapRow(user);
  }

  async findById(id: string): Promise<UserDto | null> {
    const user = await this.db.user.findUnique({ where: { id } });
    return user ? mapRow(user) : null;
  }

  async findByEmail(email: string): Promise<UserDto | null> {
    const user = await this.db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    return user ? mapRow(user) : null;
  }

  async findAll(
    { page, pageSize }: { page: number; pageSize: number } = { page: 1, pageSize: 20 }
  ): Promise<UserDto[]> {
    const users = await this.db.user.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
    });

    return users.map(mapRow);
  }
}
