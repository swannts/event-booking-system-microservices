import { PrismaClient } from "../../generated/prisma";

export type EventDatabase = PrismaClient;

export function createEventDatabase(connectionString: string): EventDatabase {
  return new PrismaClient({
    datasources: {
      db: {
        url: connectionString
      }
    }
  });
}
