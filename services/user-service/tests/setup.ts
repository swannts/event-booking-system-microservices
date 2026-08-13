import fs from "node:fs";
import path from "node:path";

const tmpDir = path.resolve(process.cwd(), ".tmp");

if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? `file:${path.join(tmpDir, "user-service.test.db")}`;
