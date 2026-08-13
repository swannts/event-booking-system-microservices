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

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    const kafka = createKafkaClient(this.config);
    this.consumer = kafka.consumer({ groupId: this.config.groupId });
    await this.consumer.connect();

    const topics = [...new Set(this.subscriptions.map((subscription) => subscription.topic))];
    for (const topic of topics) {
      await this.consumer.subscribe({ topic, fromBeginning: false });
    }

    const handlers = this.getHandlers();

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
  }

  async stop(): Promise<void> {
    if (this.consumer && this.running) {
      await this.consumer.disconnect();
      this.running = false;
    }
  }
}
