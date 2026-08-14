import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { UserClientDriver } from "../drivers/user.driver";
import { EventClientDriver } from "../drivers/event.driver";
import { BookingClientDriver } from "../drivers/booking.driver";
import { NotificationClientDriver } from "../drivers/notification.driver";
import { prepareE2ECluster, waitFor } from "../helpers/compose-environment";

describe("E2E Booking Lifecycle Spec", () => {
  const userDriver = new UserClientDriver();
  const eventDriver = new EventClientDriver();
  const bookingDriver = new BookingClientDriver();
  const notificationDriver = new NotificationClientDriver();

  beforeAll(async () => {
    await prepareE2ECluster();
  }, 240000);

  it("executes complete user creation, event creation, seat booking, and notification receipt flow", async () => {
    // 1. Create User
    const user = await userDriver.createUser({
      name: "E2E User",
      email: `e2e-user-${randomUUID()}@example.com`
    });
    expect(user.id).toBeDefined();

    // 2. Create Event
    const event = await eventDriver.createEvent({
      title: "E2E Concert",
      totalSeats: 10,
      date: new Date(Date.now() + 86400000).toISOString()
    });
    expect(event.id).toBeDefined();
    expect(event.availableSeats).toBe(10);

    // 3. Book Seat
    const idempotencyKey = `e2e-idem-${randomUUID()}`;
    const { response, data: booking } = await bookingDriver.createBooking(
      {
        userId: user.id,
        eventId: event.id,
        quantity: 2
      },
      idempotencyKey
    );

    expect(response.status).toBe(201);
    expect(booking.id).toBeDefined();
    expect(booking.status).toBe("PENDING");

    // 4. Poll Booking Status until CONFIRMED by Kafka Outbox Processor
    let confirmedBooking: any;
    await waitFor(
      async () => {
        confirmedBooking = await bookingDriver.getBookingById(booking.id);
        return confirmedBooking.status === "CONFIRMED";
      },
      30000,
      1000,
      "Booking was not confirmed in time"
    );

    expect(confirmedBooking.status).toBe("CONFIRMED");

    // 5. Verify Event Available Seats Updated
    const updatedEvent = await eventDriver.getEventById(event.id);
    expect(updatedEvent.availableSeats).toBe(8);

    // 6. Verify Notification Received by Consumer
    let notification: any;
    await waitFor(
      async () => {
        const notifications = await notificationDriver.listNotifications();
        notification = notifications.find(
          (n) => n.type === "BOOKING_CONFIRMED" && (n.payload as any)?.bookingId === booking.id
        );
        return Boolean(notification);
      },
      30000,
      1000,
      "Notification was not received in time"
    );

    expect(notification).toBeDefined();
    expect(notification.type).toBe("BOOKING_CONFIRMED");
  });
});
