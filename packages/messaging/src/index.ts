import { Kafka, logLevel, type Consumer, type Producer } from "kafkajs";
import type { MessageEnvelope, Topic } from "@event-booking/contracts";

export type KafkaConnectionConfig = {
  clientId: string;
  brokers: string[];
};

export type KafkaConsumerConfig = KafkaConnectionConfig & {
  groupId: string;
};

export type KafkaSubscription = {
  topic: Topic;
  handler: (message: MessageEnvelope<unknown>) => Promise<void>;
};

function createKafkaClient(config: KafkaConnectionConfig | KafkaConsumerConfig) {
  return new Kafka({
    clientId: config.clientId,
    brokers: config.brokers,
    logLevel: logLevel.NOTHING
  });
}

export class KafkaMessagePublisher {
  private producer: Producer | null = null;
  private connected = false;

  constructor(private readonly config: KafkaConnectionConfig) {}

  private async getProducer() {
    if (!this.producer) {
      this.producer = createKafkaClient(this.config).producer();
    }

    if (!this.connected) {
      await this.producer.connect();
      this.connected = true;
    }

    return this.producer;
  }

  async publish<TPayload>(topic: Topic, message: MessageEnvelope<TPayload>): Promise<void> {
    const producer = await this.getProducer();
    await producer.send({
      topic,
      messages: [
        {
          key: message.correlationId,
          value: JSON.stringify(message)
        }
      ]
    });
  }

  async disconnect(): Promise<void> {
    if (this.producer && this.connected) {
      await this.producer.disconnect();
      this.connected = false;
    }
  }
}

export class KafkaConsumerRunner {
  private consumer: Consumer | null = null;
  private running = false;

  constructor(
    private readonly config: KafkaConsumerConfig,
    private readonly subscriptions: KafkaSubscription[]
  ) {}

  private getHandlers() {
    return new Map<Topic, (message: MessageEnvelope<unknown>) => Promise<void>>(
      this.subscriptions.map((subscription) => [subscription.topic, subscription.handler])
    );
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    const topics = [...new Set(this.subscriptions.map((subscription) => subscription.topic))];
    const handlers = this.getHandlers();
    const maxAttempts = 10;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const kafka = createKafkaClient(this.config);
        this.consumer = kafka.consumer({ groupId: this.config.groupId });
        await this.consumer.connect();

        for (const topic of topics) {
          await this.consumer.subscribe({ topic, fromBeginning: true });
        }

        await this.consumer.run({
          eachMessage: async ({ topic, message }) => {
            const handler = handlers.get(topic as Topic);
            const value = message.value?.toString();
            if (!handler || !value) {
              return;
            }

            const parsed = JSON.parse(value) as MessageEnvelope<unknown>;
            await handler(parsed);
          }
        });

        this.running = true;
        return;
      } catch (error) {
        await this.consumer?.disconnect().catch(() => undefined);
        this.consumer = null;

        if (attempt === maxAttempts) {
          throw error;
        }

        await this.sleep(1000 * attempt);
      }
    }
  }

  async stop(): Promise<void> {
    if (this.consumer && this.running) {
      await this.consumer.disconnect();
      this.running = false;
    }
  }
}
