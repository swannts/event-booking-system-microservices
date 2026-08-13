import { PrismaClient } from "@prisma/client";

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
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}
