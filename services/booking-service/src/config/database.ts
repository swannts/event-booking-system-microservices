import { Pool } from "pg";

export type BookingDatabase = Pool;

export function createBookingDatabase(connectionString: string): BookingDatabase {
  return new Pool({ connectionString });
}
