import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { BookingController } from "../../src/modules/bookings/booking.controller";
import type { BookingsService } from "../../src/modules/bookings/booking.service";

function createResponseMock() {
  const res = {
    status: vi.fn(),
    json: vi.fn()
  } as Partial<Response>;

  res.status!.mockReturnValue(res as Response);
  res.json!.mockReturnValue(res as Response);

  return res as Response;
}

function createController(serviceOverrides?: Partial<BookingsService>) {
  const service = {
    createBooking: vi.fn(),
    getBookingById: vi.fn(),
    listBookingsForUser: vi.fn(),
    cancelBooking: vi.fn(),
    ...serviceOverrides
  } as unknown as BookingsService;

  return {
    service,
    controller: new BookingController(service)
  };
}

describe("BookingController", () => {
  it("creates a booking with the idempotency key header", async () => {
    const { controller, service } = createController({
      createBooking: vi.fn().mockResolvedValue({
        id: "booking-1",
        status: "PENDING"
      })
    });
    const res = createResponseMock();
    const next = vi.fn() as NextFunction;
    const req = {
      body: {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        eventId: "550e8400-e29b-41d4-a716-446655440001",
        quantity: 2
      },
      header: vi.fn((name: string) => (name === "Idempotency-Key" ? "booking-key-1" : undefined))
    } as unknown as Request;

    await controller.createBooking(req, res, next);

    expect(service.createBooking).toHaveBeenCalledWith({
      userId: "550e8400-e29b-41d4-a716-446655440000",
      eventId: "550e8400-e29b-41d4-a716-446655440001",
      quantity: 2,
      idempotencyKey: "booking-key-1"
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      id: "booking-1",
      status: "PENDING"
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("forwards invalid booking payloads to the error handler", async () => {
    const { controller } = createController();
    const res = createResponseMock();
    const next = vi.fn() as NextFunction;
    const req = {
      body: {
        userId: "invalid",
        quantity: 2
      },
      header: vi.fn()
    } as unknown as Request;

    await controller.createBooking(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("fetches a booking by id", async () => {
    const booking = {
      id: "booking-1",
      userId: "user-1",
      eventId: "event-1",
      quantity: 2,
      status: "CONFIRMED",
      idempotencyKey: null,
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z"
    };
    const { controller, service } = createController({
      getBookingById: vi.fn().mockResolvedValue(booking)
    });
    const res = createResponseMock();
    const next = vi.fn() as NextFunction;
    const req = {
      params: { id: "550e8400-e29b-41d4-a716-446655440000" }
    } as unknown as Request;

    await controller.getBookingById(req, res, next);

    expect(service.getBookingById).toHaveBeenCalledWith("550e8400-e29b-41d4-a716-446655440000");
    expect(res.json).toHaveBeenCalledWith(booking);
    expect(next).not.toHaveBeenCalled();
  });

  it("lists bookings for a user", async () => {
    const bookings = [
      {
        id: "booking-1",
        userId: "user-1",
        eventId: "event-1",
        quantity: 2,
        status: "PENDING",
        idempotencyKey: null,
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z"
      }
    ];
    const { controller, service } = createController({
      listBookingsForUser: vi.fn().mockResolvedValue(bookings)
    });
    const res = createResponseMock();
    const next = vi.fn() as NextFunction;
    const req = {
      params: { userId: "550e8400-e29b-41d4-a716-446655440000" }
    } as unknown as Request;

    await controller.listBookingsForUser(req, res, next);

    expect(service.listBookingsForUser).toHaveBeenCalledWith("550e8400-e29b-41d4-a716-446655440000");
    expect(res.json).toHaveBeenCalledWith(bookings);
    expect(next).not.toHaveBeenCalled();
  });

  it("cancels a booking by id", async () => {
    const cancelled = {
      id: "booking-1",
      userId: "user-1",
      eventId: "event-1",
      quantity: 2,
      status: "CANCELLED",
      idempotencyKey: null,
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z"
    };
    const { controller, service } = createController({
      cancelBooking: vi.fn().mockResolvedValue(cancelled)
    });
    const res = createResponseMock();
    const next = vi.fn() as NextFunction;
    const req = {
      params: { id: "550e8400-e29b-41d4-a716-446655440000" }
    } as unknown as Request;

    await controller.cancelBooking(req, res, next);

    expect(service.cancelBooking).toHaveBeenCalledWith("550e8400-e29b-41d4-a716-446655440000");
    expect(res.json).toHaveBeenCalledWith(cancelled);
    expect(next).not.toHaveBeenCalled();
  });
});
