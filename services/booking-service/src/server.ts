import { loadBookingServiceEnv } from "./config/env";
import { createBookingApp } from "./app";

async function main() {
  const env = loadBookingServiceEnv();
  const app = await createBookingApp();
  const server = app.listen(env.PORT, () => {
    console.log(`booking-service listening on ${env.PORT}`);
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
