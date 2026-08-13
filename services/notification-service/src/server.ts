import { loadNotificationServiceEnv } from "./config/env";
import { createNotificationApp } from "./app";

async function main() {
  const env = loadNotificationServiceEnv();
  const app = await createNotificationApp();
  const server = app.listen(env.PORT, () => {
    console.log(`notification-service listening on ${env.PORT}`);
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
