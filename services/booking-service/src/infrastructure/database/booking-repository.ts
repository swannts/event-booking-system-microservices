import type { QueryResultRow } from "pg";
import type { BookingStatus } from "@event-booking/contracts";

export type BookingRecord = {
  id: string;
  user_id: string;
  event_id: string;
  quantity: number;
  status: BookingStatus;
  idempotency_key: string | null;
  created_at: Date;
  updated_at: Date;
};

export type BookingDto = {
  id: string;
  userId: string;
  eventId: string;
  quantity: number;
  status: BookingStatus;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BookingDatabaseClient = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[]
  ): Promise<{
    rows: T[];
    rowCount: number;
  }>;
  end(): Promise<void>;
};

function mapRow(row: BookingRecord): BookingDto {
  return {
    id: row.id,
    userId: row.user_id,
    eventId: row.event_id,
    quantity: row.quantity,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export async function ensureBookingTables(db: BookingDatabaseClient) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL,
      event_id UUID NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      status VARCHAR(32) NOT NULL,
      idempotency_key VARCHAR(255) UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS booking_idempotency_keys (
      key VARCHAR(255) PRIMARY KEY,
      booking_id UUID NOT NULL UNIQUE,
      response JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export class PostgresBookingRepository {
  constructor(private readonly db: BookingDatabaseClient) {}

  async create(input: {
    id: string;
    userId: string;
    eventId: string;
    quantity: number;
    status: BookingStatus;
    idempotencyKey: string | null;
  }): Promise<BookingDto> {
    const result = await this.db.query<BookingRecord>(
      `
      INSERT INTO bookings (id, user_id, event_id, quantity, status, idempotency_key)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, user_id, event_id, quantity, status, idempotency_key, created_at, updated_at
    `,
      [input.id, input.userId, input.eventId, input.quantity, input.status, input.idempotencyKey]
    );

    return mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<BookingDto | null> {
    const result = await this.db.query<BookingRecord>(
      `SELECT id, user_id, event_id, quantity, status, idempotency_key, created_at, updated_at FROM bookings WHERE id = $1`,
      [id]
    );

    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<BookingDto[]> {
    const result = await this.db.query<BookingRecord>(
      `SELECT id, user_id, event_id, quantity, status, idempotency_key, created_at, updated_at FROM bookings WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId]
    );

    return result.rows.map(mapRow);
  }

  async findByIdempotencyKey(key: string): Promise<BookingDto | null> {
    const result = await this.db.query<BookingRecord>(
      `SELECT id, user_id, event_id, quantity, status, idempotency_key, created_at, updated_at FROM bookings WHERE idempotency_key = $1`,
      [key]
    );

    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async updateStatus(id: string, status: BookingStatus): Promise<BookingDto | null> {
    const result = await this.db.query<BookingRecord>(
      `
      UPDATE bookings
      SET status = $2,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, user_id, event_id, quantity, status, idempotency_key, created_at, updated_at
    `,
      [id, status]
    );

    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async storeIdempotencyKey(input: {
    key: string;
    bookingId: string;
    response: unknown;
  }): Promise<void> {
    await this.db.query(
      `
      INSERT INTO booking_idempotency_keys (key, booking_id, response)
      VALUES ($1, $2, $3)
    `,
      [input.key, input.bookingId, JSON.stringify(input.response)]
    );
  }

  async findIdempotencyResponse(key: string): Promise<unknown | null> {
    const result = await this.db.query<{ response: unknown }>(
      `SELECT response FROM booking_idempotency_keys WHERE key = $1`,
      [key]
    );
    return result.rows[0]?.response ?? null;
  }
}
