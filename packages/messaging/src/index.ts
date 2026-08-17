import { Kafka, logLevel, type Consumer, type Producer } from "kafkajs";
import { parseMessageEnvelope, type MessageEnvelope, type MessageForTopic, type Topic } from "@event-booking/contracts";
import { ZodError } from "zod";
import { observeDomain } from "@event-booking/observability";

export type KafkaConnectionConfig = {
  clientId: string;
  brokers: string[];
};

export type KafkaConsumerConfig = KafkaConnectionConfig & {
  groupId: string;
};

export type KafkaSubscription = {
  topic: Topic;
  handle: (message: unknown) => Promise<void>;
};

export type DeadLetterRecord = {
  sourceTopic: string;
  partition: number;
  offset: string;
  key: string | null;
  rawPayload: string | null;
  consumer: string;
  error: string;
  timestamp: string;
};

export class PermanentMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentMessageError";
  }
}

export function createKafkaSubscription<TTopic extends Topic>(
  topic: TTopic,
  handler: (message: MessageForTopic<TTopic>) => Promise<void>
): KafkaSubscription {
  return {
    topic,
    handle: async (message) => handler(parseMessageEnvelope(topic, message))
  };
}

export async function processKafkaRecord(input: {
  subscription: KafkaSubscription;
  rawPayload: string | null;
  partition: number;
  offset: string;
  key: string | null;
  consumer: string;
  publishDeadLetter: (topic: string, record: DeadLetterRecord) => Promise<void>;
}): Promise<"processed" | "dead-lettered"> {
  try {
    if (input.rawPayload === null) {
      throw new SyntaxError("Kafka message payload is empty");
    }

    await input.subscription.handle(JSON.parse(input.rawPayload));
    return "processed";
  } catch (error) {
    const permanent =
      error instanceof SyntaxError || error instanceof ZodError || error instanceof PermanentMessageError;
    if (!permanent) {
      observeDomain(input.consumer, "kafka_processing", "failure");
      throw error;
    }

    const record: DeadLetterRecord = {
      sourceTopic: input.subscription.topic,
      partition: input.partition,
      offset: input.offset,
      key: input.key,
      rawPayload: input.rawPayload,
      consumer: input.consumer,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
    await input.publishDeadLetter(`dead-letter.${input.subscription.topic}`, record);
    observeDomain(
      input.consumer,
      error instanceof SyntaxError ? "kafka_invalid_message" : "kafka_invalid_envelope",
      "dead_lettered"
    );
    observeDomain(input.consumer, "kafka_dlq", "published");
    return "dead-lettered";
  }
}

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
  private deadLetterProducer: Producer | null = null;
  private deadLetterProducerConnected = false;
  private running = false;

  constructor(
    private readonly config: KafkaConsumerConfig,
    private readonly subscriptions: KafkaSubscription[]
  ) {}

  private getSubscriptions() {
    return new Map<Topic, KafkaSubscription>(
      this.subscriptions.map((subscription) => [subscription.topic, subscription])
    );
  }

  private async publishDeadLetter(topic: string, record: DeadLetterRecord): Promise<void> {
    if (!this.deadLetterProducer) {
      this.deadLetterProducer = createKafkaClient(this.config).producer();
    }
    if (!this.deadLetterProducerConnected) {
      await this.deadLetterProducer.connect();
      this.deadLetterProducerConnected = true;
    }

    await this.deadLetterProducer.send({
      topic,
      messages: [{ key: record.key ?? record.sourceTopic, value: JSON.stringify(record) }]
    });
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    const topics = [...new Set(this.subscriptions.map((subscription) => subscription.topic))];
    const subscriptions = this.getSubscriptions();
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
          eachMessage: async ({ topic, partition, message }) => {
            const subscription = subscriptions.get(topic as Topic);
            if (!subscription) {
              return;
            }

            await processKafkaRecord({
              subscription,
              rawPayload: message.value?.toString() ?? null,
              partition,
              offset: message.offset,
              key: message.key?.toString() ?? null,
              consumer: this.config.clientId,
              publishDeadLetter: (deadLetterTopic, record) => this.publishDeadLetter(deadLetterTopic, record)
            });
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
    if (this.deadLetterProducer && this.deadLetterProducerConnected) {
      await this.deadLetterProducer.disconnect();
      this.deadLetterProducerConnected = false;
    }
  }

  isRunning(): boolean {
    return this.running;
  }
}
