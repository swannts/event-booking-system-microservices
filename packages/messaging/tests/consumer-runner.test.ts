import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { Topics } from "@event-booking/contracts";
import { createKafkaSubscription, PermanentMessageError, processKafkaRecord, type DeadLetterRecord } from "../src";

function validMessage() {
  return {
    messageId: randomUUID(),
    correlationId: randomUUID(),
    timestamp: new Date().toISOString(),
    version: 1,
    payload: {
      bookingId: randomUUID(),
      eventId: randomUUID(),
      userId: randomUUID(),
      quantity: 1
    }
  };
}

function harness(handler = vi.fn(async () => undefined)) {
  const deadLetters: Array<{ topic: string; record: DeadLetterRecord }> = [];
  const subscription = createKafkaSubscription(Topics.RESERVE_SEATS, handler);
  const process = (rawPayload: string | null) =>
    processKafkaRecord({
      subscription,
      rawPayload,
      partition: 2,
      offset: "42",
      key: "booking-key",
      consumer: "event-service",
      publishDeadLetter: async (topic, record) => {
        deadLetters.push({ topic, record });
      }
    });
  return { deadLetters, handler, process };
}

describe("Kafka record processing", () => {
  it("dead-letters malformed JSON with source context", async () => {
    const test = harness();
    await expect(test.process("{not-json")).resolves.toBe("dead-lettered");
    expect(test.deadLetters).toHaveLength(1);
    expect(test.deadLetters[0]).toMatchObject({
      topic: "dead-letter.booking.reserve-seats",
      record: {
        sourceTopic: Topics.RESERVE_SEATS,
        partition: 2,
        offset: "42",
        key: "booking-key",
        rawPayload: "{not-json",
        consumer: "event-service"
      }
    });
  });

  it.each([
    ["invalid envelope", { ...validMessage(), messageId: "not-a-uuid" }],
    ["unsupported version", { ...validMessage(), version: 2 }],
    ["invalid payload", { ...validMessage(), payload: { ...validMessage().payload, quantity: 0 } }]
  ])("dead-letters %s", async (_name, message) => {
    const test = harness();
    await expect(test.process(JSON.stringify(message))).resolves.toBe("dead-lettered");
    expect(test.handler).not.toHaveBeenCalled();
    expect(test.deadLetters).toHaveLength(1);
  });

  it("dead-letters explicit permanent processing errors", async () => {
    const test = harness(vi.fn(async () => Promise.reject(new PermanentMessageError("Unknown aggregate"))));
    await expect(test.process(JSON.stringify(validMessage()))).resolves.toBe("dead-lettered");
    expect(test.deadLetters[0]?.record.error).toBe("Unknown aggregate");
  });

  it("rethrows transient failures so Kafka retries them", async () => {
    const test = harness(vi.fn(async () => Promise.reject(new Error("Database unavailable"))));
    await expect(test.process(JSON.stringify(validMessage()))).rejects.toThrow("Database unavailable");
    expect(test.deadLetters).toHaveLength(0);
  });

  it("does not let a poison message block a valid later message", async () => {
    const test = harness();
    await test.process("bad-json");
    await expect(test.process(JSON.stringify(validMessage()))).resolves.toBe("processed");
    expect(test.deadLetters).toHaveLength(1);
    expect(test.handler).toHaveBeenCalledTimes(1);
  });
});
