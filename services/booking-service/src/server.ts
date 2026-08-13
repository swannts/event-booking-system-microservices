import { Pool } from "pg";
import { loadBookingServiceEnv } from "./config/env";
import { createBookingApp } from "./app";
import type { MessageEnvelope, Topic } from "@event-booking/contracts";
import type { MessagePublisher } from "./infrastructure/messaging/message-publisher";

class ConsoleMessagePublisher implements MessagePublisher {
  async publish<TPayload>(topic: Topic, message: MessageEnvelope<TPayload>) {
    console.log(JSON.stringify({ topic, ...message }));
  }
}

async function main() {
  const env = loadBookingServiceEnv();
  const db = new Pool({ connectionString: env.DATABASE_URL });
  const app = await createBookingApp({
    db,
    publisher: new ConsoleMessagePublisher()
  });
  const server = app.listen(env.PORT, () => {
    console.log(`booking-service listening on ${env.PORT}`);
  });

  const shutdown = () =>
    server.close(async () => {
      await db.end();
      process.exit(0);
    });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
