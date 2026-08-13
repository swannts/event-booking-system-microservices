import type { MessageEnvelope, Topic } from "@event-booking/contracts";

export interface MessagePublisher {
  publish<TPayload>(topic: Topic, message: MessageEnvelope<TPayload>): Promise<void>;
}

export class InMemoryMessagePublisher implements MessagePublisher {
  public readonly messages: Array<{ topic: Topic; message: MessageEnvelope<unknown> }> = [];

  async publish<TPayload>(topic: Topic, message: MessageEnvelope<TPayload>): Promise<void> {
    this.messages.push({ topic, message });
  }
}
