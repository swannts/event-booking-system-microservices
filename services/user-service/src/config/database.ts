import { PrismaClient } from "../../generated/prisma";

export type UserDatabase = PrismaClient;

export function createUserDatabase(connectionString: string): UserDatabase {
  return new PrismaClient({
    datasources: {
      db: {
        url: connectionString
      }
    }
  });
}

export async function ensureUsersTable(db: UserDatabase): Promise<void> {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}
