import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { parseMessageEnvelope, Topics } from "../src";

function reserveSeatsMessage() {
  return {
    messageId: randomUUID(),
    correlationId: randomUUID(),
    timestamp: new Date().toISOString(),
    version: 1,
    payload: {
      bookingId: randomUUID(),
      eventId: randomUUID(),
      userId: randomUUID(),
      quantity: 2
    }
  };
}

describe("Kafka contract schemas", () => {
  it("parses a valid topic-specific envelope", () => {
    expect(parseMessageEnvelope(Topics.RESERVE_SEATS, reserveSeatsMessage()).payload.quantity).toBe(2);
  });

  it("rejects unsupported message versions", () => {
    expect(() => parseMessageEnvelope(Topics.RESERVE_SEATS, { ...reserveSeatsMessage(), version: 2 })).toThrow();
  });

  it("rejects invalid envelope UUIDs", () => {
    expect(() => parseMessageEnvelope(Topics.RESERVE_SEATS, { ...reserveSeatsMessage(), messageId: "invalid" })).toThrow();
  });

  it("rejects invalid topic payloads", () => {
    const message = reserveSeatsMessage();
    expect(() =>
      parseMessageEnvelope(Topics.RESERVE_SEATS, {
        ...message,
        payload: { ...message.payload, quantity: 0 }
      })
    ).toThrow();
  });
});
