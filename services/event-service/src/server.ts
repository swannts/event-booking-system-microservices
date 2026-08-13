import { loadEventServiceEnv } from "./config/env";
import { createEventApp } from "./app";

async function main() {
  const env = loadEventServiceEnv();
  const app = await createEventApp();
  const server = app.listen(env.PORT, () => {
    console.log(`event-service listening on ${env.PORT}`);
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
