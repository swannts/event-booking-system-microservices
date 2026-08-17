import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { UserClientDriver } from "../drivers/user.driver";
import { EventClientDriver } from "../drivers/event.driver";
import { BookingClientDriver } from "../drivers/booking.driver";
import { waitFor } from "../helpers/compose-environment";

describe("E2E Concurrency & Overselling Prevention Spec", () => {
  const userDriver = new UserClientDriver();
  const eventDriver = new EventClientDriver();
  const bookingDriver = new BookingClientDriver();

  it("prevents seat overselling under high parallel concurrency", async () => {
    // 1. Create User
    const user = await userDriver.createUser({
      name: "Concurrent Tester",
      email: `concurrent-${randomUUID()}@example.com`
    });

    // 2. Create Event with exactly 5 seats
    const event = await eventDriver.createEvent({
      title: "Exclusive Flash Sale Event",
      totalSeats: 5,
      date: new Date(Date.now() + 86400000).toISOString()
    });

    // 3. Fire 15 simultaneous booking requests of 1 seat each (Total requested: 15, Available: 5)
    const totalRequests = 15;
    const bookingPromises = Array.from({ length: totalRequests }, (_, i) =>
      bookingDriver.createBooking(
        {
          userId: user.id,
          eventId: event.id,
          quantity: 1
        },
        `concurrent-idem-${i}-${randomUUID()}`
      )
    );

    const results = await Promise.all(bookingPromises);
    const createdBookingIds = results.filter((r) => r.response.status === 201).map((r) => r.data.id);

    expect(createdBookingIds.length).toBe(totalRequests);

    // 4. Wait for processing of all booking status outbox events
    await waitFor(
      async () => {
        const statuses = await Promise.all(
          createdBookingIds.map(async (id) => {
            const b = await bookingDriver.getBookingById(id);
            return b.status;
          })
        );
        return statuses.every((s) => s === "CONFIRMED" || s === "FAILED");
      },
      45000,
      1000,
      "Not all bookings resolved to terminal state"
    );

    // 5. Verify final status distribution & seat availability
    const finalBookings = await Promise.all(createdBookingIds.map((id) => bookingDriver.getBookingById(id)));
    const confirmedCount = finalBookings
      .filter((b) => b.status === "CONFIRMED")
      .reduce((sum, b) => sum + b.quantity, 0);
    const failedCount = finalBookings.filter((b) => b.status === "FAILED").length;

    const finalEvent = await eventDriver.getEventById(event.id);

    expect(confirmedCount).toBe(5);
    expect(failedCount).toBe(10);
    expect(finalEvent.availableSeats).toBe(0);
  });
});
