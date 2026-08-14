process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/event_booking";
