import type { PrismaClient, User as UserModel } from "@prisma/client";

export interface UserRepository {
  create(input: { id: string; name: string; email: string }): Promise<UserDto>;
  findById(id: string): Promise<UserDto | null>;
  findByEmail(email: string): Promise<UserDto | null>;
  findAll(): Promise<UserDto[]>;
}

export type UserDto = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
};

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
        email: input.email
      }
    });

    return mapRow(user);
  }

  async findById(id: string): Promise<UserDto | null> {
    const user = await this.db.user.findUnique({ where: { id } });
    return user ? mapRow(user) : null;
  }

  async findByEmail(email: string): Promise<UserDto | null> {
    const user = await this.db.user.findUnique({ where: { email } });
    return user ? mapRow(user) : null;
  }

  async findAll(): Promise<UserDto[]> {
    const users = await this.db.user.findMany({
      orderBy: {
        createdAt: "asc"
      }
    });

    return users.map(mapRow);
  }
}
