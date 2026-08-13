import { Pool } from "pg";
import { loadUserServiceEnv } from "./config";
import { createUserApp } from "./app";

async function main() {
  const env = loadUserServiceEnv();
  const db = new Pool({ connectionString: env.DATABASE_URL });
  const app = await createUserApp({ db });

  const server = app.listen(env.PORT, () => {
    console.log(`user-service listening on ${env.PORT}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await db.end();
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
