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
