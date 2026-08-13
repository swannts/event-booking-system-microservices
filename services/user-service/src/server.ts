import { loadUserServiceEnv } from "./config/env";
import { createUserApp } from "./app";
import { createUserDatabase } from "./config/database";

async function main() {
  const env = loadUserServiceEnv();
  const db = createUserDatabase(env.DATABASE_URL);
  await db.$connect();
  const app = await createUserApp({ db });

  const server = app.listen(env.PORT, () => {
    console.log(`user-service listening on ${env.PORT}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await db.$disconnect();
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
