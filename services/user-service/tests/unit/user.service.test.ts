import { describe, expect, it, vi } from "vitest";
import { UserErrors } from "../../src/modules/users/user.errors";
import { UsersService } from "../../src/modules/users/user.service";
import type { UserRepository } from "../../src/modules/users/user.repository";

function createRepository(overrides: Partial<UserRepository> = {}): UserRepository {
  return {
    create: vi.fn(async (input) => ({
      id: input.id,
      name: input.name,
      email: input.email,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })),
    findById: vi.fn(async () => null),
    findByEmail: vi.fn(async () => null),
    findAll: vi.fn(async () => []),
    ...overrides
  };
}

describe("UsersService", () => {
  it("creates a user with a generated id", async () => {
    const repository = createRepository();
    const service = new UsersService(repository);

    const user = await service.createUser({
      name: "John Doe",
      email: "john@example.com"
    });

    expect(user.email).toBe("john@example.com");
    expect(repository.create).toHaveBeenCalledWith({
      id: expect.any(String),
      name: "John Doe",
      email: "john@example.com"
    });
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate email before creation", async () => {
    const repository = createRepository({
      findByEmail: vi.fn(async () => ({
        id: "existing",
        name: "Existing User",
        email: "john@example.com",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }))
    });
    const service = new UsersService(repository);

    await expect(
      service.createUser({
        name: "John Doe",
        email: "john@example.com"
      })
    ).rejects.toMatchObject({
      code: UserErrors.duplicateEmail().code
    });
  });

  it("returns a user by id", async () => {
    const repository = createRepository({
      findById: vi.fn(async (id) => ({
        id,
        name: "John Doe",
        email: "john@example.com",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }))
    });
    const service = new UsersService(repository);

    await expect(service.getUserById("user-id")).resolves.toMatchObject({
      id: "user-id",
      email: "john@example.com"
    });
  });

  it("lists users", async () => {
    const repository = createRepository({
      findAll: vi.fn(async () => [
        {
          id: "user-id",
          name: "John Doe",
          email: "john@example.com",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ])
    });
    const service = new UsersService(repository);

    await expect(service.listUsers()).resolves.toHaveLength(1);
  });
});
