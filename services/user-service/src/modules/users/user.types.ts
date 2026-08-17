export type UserDto = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateUserInput = {
  id: string;
  name: string;
  email: string;
};

export interface UserRepository {
  create(input: CreateUserInput): Promise<UserDto>;
  findById(id: string): Promise<UserDto | null>;
  findByEmail(email: string): Promise<UserDto | null>;
  findAll(pagination?: { page: number; pageSize: number }): Promise<UserDto[]>;
}
