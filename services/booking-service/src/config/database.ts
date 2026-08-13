import { PrismaClient } from "@prisma/client";

export type BookingDatabase = PrismaClient;

export function createBookingDatabase(connectionString: string): BookingDatabase {
  return new PrismaClient({
    datasources: {
      db: {
        url: connectionString
      }
    }
  });
}
