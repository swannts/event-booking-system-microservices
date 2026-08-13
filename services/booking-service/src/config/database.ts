import { PrismaClient } from "@prisma/client";
import type { BookingTransactionalClient } from "../infrastructure/database/booking-repository";

export type BookingDatabase = PrismaClient & BookingTransactionalClient;

export function createBookingDatabase(connectionString: string): BookingDatabase {
  return new PrismaClient({
    datasources: {
      db: {
        url: connectionString
      }
    }
  }) as BookingDatabase;
}
