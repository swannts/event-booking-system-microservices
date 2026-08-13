import type { QueryResultRow } from "pg";

export type UserRecord = {
  id: string;
  name: string;
  email: string;
  created_at: Date;
  updated_at: Date;
};

type DatabaseClient = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: readonly unknown[]): Promise<{
    rows: T[];
    rowCount: number;
  }>;
  end(): Promise<void>;
};

export interface UserRepository {
  create(input: { id: string; name: string; email: string }): Promise<UserDto>;
  findById(id: string): Promise<UserDto | null>;
  findByEmail(email: string): Promise<UserDto | null>;
  findAll(): Promise<UserDto[]>;
}

export type UserDto = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
};

function mapRow(row: UserRecord): UserDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export async function ensureUsersTable(db: DatabaseClient) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(input: { id: string; name: string; email: string }): Promise<UserDto> {
    const result = await this.db.query<UserRecord>(
      `
      INSERT INTO users (id, name, email)
      VALUES ($1, $2, $3)
      RETURNING id, name, email, created_at, updated_at
    `,
      [input.id, input.name, input.email]
    );

    return mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<UserDto | null> {
    const result = await this.db.query<UserRecord>(
      `SELECT id, name, email, created_at, updated_at FROM users WHERE id = $1`,
      [id]
    );

    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findByEmail(email: string): Promise<UserDto | null> {
    const result = await this.db.query<UserRecord>(
      `SELECT id, name, email, created_at, updated_at FROM users WHERE email = $1`,
      [email]
    );

    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findAll(): Promise<UserDto[]> {
    const result = await this.db.query<UserRecord>(
      `SELECT id, name, email, created_at, updated_at FROM users ORDER BY created_at ASC`
    );

    return result.rows.map(mapRow);
  }
}
