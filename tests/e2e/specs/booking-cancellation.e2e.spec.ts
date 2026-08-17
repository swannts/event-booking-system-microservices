import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { BookingClientDriver, type BookingResponse } from "../drivers/booking.driver";
import { EventClientDriver } from "../drivers/event.driver";
import { NotificationClientDriver } from "../drivers/notification.driver";
import { UserClientDriver } from "../drivers/user.driver";
import { compose, prepareE2ECluster, waitFor } from "../helpers/compose-environment";

describe("E2E booking cancellation", () => {
  const bookingDriver = new BookingClientDriver();
  const eventDriver = new EventClientDriver();
  const notificationDriver = new NotificationClientDriver();
  const userDriver = new UserClientDriver();

  beforeAll(async () => {
    await prepareE2ECluster();
  }, 240000);

  async function createConfirmedBooking(totalSeats: number, quantity: number) {
    const user = await userDriver.createUser({
      name: "Cancellation E2E User",
      email: `cancellation-${randomUUID()}@example.com`
    });
    const event = await eventDriver.createEvent({
      title: "Cancellation E2E Event",
      totalSeats,
      date: new Date(Date.now() + 86_400_000).toISOString()
    });
    const created = await bookingDriver.createBooking(
      { userId: user.id, eventId: event.id, quantity },
      `cancellation-${randomUUID()}`
    );

    expect(created.response.status).toBe(201);

    let booking: BookingResponse | undefined;
    await waitFor(
      async () => {
        booking = await bookingDriver.getBookingById(created.data.id);
        return booking.status === "CONFIRMED";
      },
      45_000,
      500,
      "Booking was not confirmed before cancellation"
    );

    return { booking: booking!, event, user };
  }

  function cancellationOutboxCount(bookingId: string): number {
    const sql = `SELECT COUNT(*) FROM booking_outbox_events WHERE topic = 'booking.cancelled' AND message->'payload'->>'bookingId' = '${bookingId}'`;
    return Number(
      compose(["exec", "-T", "booking-db", "psql", "-U", "postgres", "-d", "event_booking", "-Atc", sql])
    );
  }

  it("restores seats exactly once and emits a cancellation notification", async () => {
    const originalCapacity = 10;
    const quantity = 3;
    const { booking, event } = await createConfirmedBooking(originalCapacity, quantity);

    expect((await eventDriver.getEventById(event.id)).availableSeats).toBe(originalCapacity - quantity);

    const cancelled = await bookingDriver.cancelBooking(booking.id);
    expect(cancelled.status).toBe("CANCELLED");

    await waitFor(
      async () => {
        const [currentBooking, currentEvent, notifications] = await Promise.all([
          bookingDriver.getBookingById(booking.id),
          eventDriver.getEventById(event.id),
          notificationDriver.listNotifications()
        ]);
        return (
          currentBooking.status === "CANCELLED" &&
          currentEvent.availableSeats === originalCapacity &&
          notifications.some(
            (notification) => notification.type === "BOOKING_CANCELLED" && notification.bookingId === booking.id
          )
        );
      },
      45_000,
      500,
      "Cancellation processing did not restore inventory and notify"
    );

    const finalEvent = await eventDriver.getEventById(event.id);
    const cancellationNotifications = (await notificationDriver.listNotifications()).filter(
      (notification) => notification.type === "BOOKING_CANCELLED" && notification.bookingId === booking.id
    );

    expect(finalEvent.availableSeats).toBe(originalCapacity);
    expect(finalEvent.availableSeats).toBeLessThanOrEqual(finalEvent.totalSeats);
    expect(cancellationNotifications).toHaveLength(1);
    expect(cancellationOutboxCount(booking.id)).toBe(1);
  });

  it("allows only one concurrent cancellation transition and cannot over-release seats", async () => {
    const originalCapacity = 7;
    const quantity = 2;
    const { booking, event } = await createConfirmedBooking(originalCapacity, quantity);

    const attempts = await Promise.all(
      Array.from({ length: 10 }, () => bookingDriver.requestCancellation(booking.id))
    );
    const successful = attempts.filter(({ response }) => response.status === 200);
    const conflicts = attempts.filter(({ response }) => response.status === 409);

    expect(successful).toHaveLength(1);
    expect(conflicts).toHaveLength(9);

    await waitFor(
      async () => {
        const [currentEvent, notifications] = await Promise.all([
          eventDriver.getEventById(event.id),
          notificationDriver.listNotifications()
        ]);
        return (
          currentEvent.availableSeats === originalCapacity &&
          notifications.filter(
            (notification) => notification.type === "BOOKING_CANCELLED" && notification.bookingId === booking.id
          ).length === 1
        );
      },
      45_000,
      500,
      "Concurrent cancellation did not settle exactly once"
    );

    const finalBooking = await bookingDriver.getBookingById(booking.id);
    const finalEvent = await eventDriver.getEventById(event.id);
    const cancellationNotifications = (await notificationDriver.listNotifications()).filter(
      (notification) => notification.type === "BOOKING_CANCELLED" && notification.bookingId === booking.id
    );

    expect(finalBooking.status).toBe("CANCELLED");
    expect(finalEvent.availableSeats).toBe(originalCapacity);
    expect(finalEvent.availableSeats).toBeLessThanOrEqual(finalEvent.totalSeats);
    expect(cancellationOutboxCount(booking.id)).toBe(1);
    expect(cancellationNotifications).toHaveLength(1);
  });
});
