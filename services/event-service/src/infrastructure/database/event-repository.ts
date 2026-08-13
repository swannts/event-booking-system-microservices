import type { QueryResultRow } from "pg";

export type EventRecord = {
  id: string;
  title: string;
  date: Date;
  total_seats: number;
  available_seats: number;
  created_at: Date;
  updated_at: Date;
};

export type DatabaseClient = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[]
  ): Promise<{
    rows: T[];
    rowCount: number;
  }>;
  end(): Promise<void>;
};

export type EventDto = {
  id: string;
  title: string;
  date: string;
  totalSeats: number;
  availableSeats: number;
  createdAt: string;
  updatedAt: string;
};

function mapRow(row: EventRecord): EventDto {
  return {
    id: row.id,
    title: row.title,
    date: row.date.toISOString(),
    totalSeats: row.total_seats,
    availableSeats: row.available_seats,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export async function ensureEventsTable(db: DatabaseClient) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS events (
      id UUID PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      date TIMESTAMPTZ NOT NULL,
      total_seats INTEGER NOT NULL CHECK (total_seats > 0),
      available_seats INTEGER NOT NULL CHECK (available_seats >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export class PostgresEventRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(input: {
    id: string;
    title: string;
    date: string;
    totalSeats: number;
    availableSeats?: number;
  }): Promise<EventDto> {
    const availableSeats = input.availableSeats ?? input.totalSeats;
    const result = await this.db.query<EventRecord>(
      `
      INSERT INTO events (id, title, date, total_seats, available_seats)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, title, date, total_seats, available_seats, created_at, updated_at
    `,
      [input.id, input.title, input.date, input.totalSeats, availableSeats]
    );

    return mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<EventDto | null> {
    const result = await this.db.query<EventRecord>(
      `SELECT id, title, date, total_seats, available_seats, created_at, updated_at FROM events WHERE id = $1`,
      [id]
    );

    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async list(): Promise<EventDto[]> {
    const result = await this.db.query<EventRecord>(
      `SELECT id, title, date, total_seats, available_seats, created_at, updated_at FROM events ORDER BY created_at ASC`
    );

    return result.rows.map(mapRow);
  }

  async update(
    id: string,
    input: { title: string; date: string; totalSeats: number }
  ): Promise<EventDto | null> {
    const current = await this.db.query<EventRecord>(
      `SELECT id, title, date, total_seats, available_seats, created_at, updated_at FROM events WHERE id = $1`,
      [id]
    );

    if (!current.rows[0]) {
      return null;
    }

    const reservedSeats = current.rows[0].total_seats - current.rows[0].available_seats;
    if (input.totalSeats < reservedSeats) {
      throw new Error("AVAILABLE_SEATS_CANNOT_EXCEED_TOTAL_SEATS");
    }

    const availableSeats = input.totalSeats - reservedSeats;
    const result = await this.db.query<EventRecord>(
      `
      UPDATE events
      SET title = $2,
          date = $3,
          total_seats = $4,
          available_seats = $5,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, title, date, total_seats, available_seats, created_at, updated_at
    `,
      [id, input.title, input.date, input.totalSeats, availableSeats]
    );

    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.query(`DELETE FROM events WHERE id = $1`, [id]);
    return result.rowCount > 0;
  }

  async reserveSeats(id: string, quantity: number): Promise<EventDto | null> {
    const result = await this.db.query<EventRecord>(
      `
      UPDATE events
      SET available_seats = available_seats - $1,
          updated_at = NOW()
      WHERE id = $2
        AND available_seats >= $1
      RETURNING id, title, date, total_seats, available_seats, created_at, updated_at
    `,
      [quantity, id]
    );

    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async releaseSeats(id: string, quantity: number): Promise<EventDto | null> {
    const result = await this.db.query<EventRecord>(
      `
      UPDATE events
      SET available_seats = available_seats + $1,
          updated_at = NOW()
      WHERE id = $2
      RETURNING id, title, date, total_seats, available_seats, created_at, updated_at
    `,
      [quantity, id]
    );

    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }
}
