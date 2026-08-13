import { describe, expect, it, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { EventsService } from "../../src/modules/events/event.service";
import { EventErrors } from "../../src/modules/events/event.errors";
import type { EventCache } from "../../src/infrastructure/cache/event-cache";
import type { EventRepository } from "../../src/modules/events/event.repository";

function createEventDto(overrides: Partial<{
  id: string;
  title: string;
  date: string;
  totalSeats: number;
  availableSeats: number;
  createdAt: string;
  updatedAt: string;
}> = {}) {
  return {
    id: overrides.id ?? randomUUID(),
    title: overrides.title ?? "Node.js Conference",
    date: overrides.date ?? "2026-09-20T10:00:00.000Z",
    totalSeats: overrides.totalSeats ?? 100,
    availableSeats: overrides.availableSeats ?? 100,
    createdAt: overrides.createdAt ?? "2026-08-13T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-08-13T00:00:00.000Z"
  };
}

class FakeRepository implements Pick<EventRepository, "create" | "findById" | "update" | "delete"> {
  public create = vi.fn();
  public findById = vi.fn();
  public update = vi.fn();
  public delete = vi.fn();
}

class FakeCache implements Pick<EventCache, "get" | "set" | "del"> {
  public get = vi.fn();
  public set = vi.fn();
  public del = vi.fn();
}

describe("EventsService", () => {
  let repository: FakeRepository;
  let cache: FakeCache;
  let service: EventsService;

  beforeEach(() => {
    repository = new FakeRepository();
    cache = new FakeCache();
    service = new EventsService(repository as unknown as EventRepository, cache as unknown as EventCache, 120);
  });

  it("creates an event", async () => {
    const event = createEventDto();
    repository.create.mockResolvedValue(event);

    const result = await service.createEvent({
      title: event.title,
      date: event.date,
      totalSeats: event.totalSeats
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: event.title,
        date: event.date,
        totalSeats: event.totalSeats
      })
    );
    expect(result).toEqual(event);
  });

  it("returns an existing event from repository when cache misses", async () => {
    const event = createEventDto();
    cache.get.mockResolvedValue(null);
    repository.findById.mockResolvedValue(event);

    const result = await service.getEventById(event.id);

    expect(cache.get).toHaveBeenCalledWith(event.id);
    expect(repository.findById).toHaveBeenCalledWith(event.id);
    expect(cache.set).toHaveBeenCalledWith(event.id, event, 120);
    expect(result).toEqual(event);
  });

  it("returns a cached event without querying the repository on cache hit", async () => {
    const event = createEventDto();
    cache.get.mockResolvedValue(event);

    const result = await service.getEventById(event.id);

    expect(cache.get).toHaveBeenCalledWith(event.id);
    expect(repository.findById).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
    expect(result).toEqual(event);
  });

  it("throws not found when an event does not exist", async () => {
    cache.get.mockResolvedValue(null);
    repository.findById.mockResolvedValue(null);

    await expect(service.getEventById(randomUUID())).rejects.toMatchObject({
      code: EventErrors.notFound().code,
      statusCode: 404
    });
  });

  it("updates an event and invalidates the cache", async () => {
    const event = createEventDto();
    const updated = createEventDto({
      id: event.id,
      title: "Updated Conference",
      date: "2026-09-21T10:00:00.000Z",
      totalSeats: 90,
      availableSeats: 90
    });
    repository.update.mockResolvedValue(updated);

    const result = await service.updateEvent(event.id, {
      title: updated.title,
      date: updated.date,
      totalSeats: updated.totalSeats
    });

    expect(repository.update).toHaveBeenCalledWith(event.id, {
      title: updated.title,
      date: updated.date,
      totalSeats: updated.totalSeats
    });
    expect(cache.del).toHaveBeenCalledWith(event.id);
    expect(result).toEqual(updated);
  });

  it("deletes an event and invalidates the cache", async () => {
    repository.delete.mockResolvedValue(true);

    await service.deleteEvent("event-1");

    expect(repository.delete).toHaveBeenCalledWith("event-1");
    expect(cache.del).toHaveBeenCalledWith("event-1");
  });

  it("rethrows repository validation errors as validation errors", async () => {
    cache.get.mockResolvedValue(null);
    repository.update.mockRejectedValue(new Error("AVAILABLE_SEATS_CANNOT_EXCEED_TOTAL_SEATS"));

    await expect(
      service.updateEvent("event-1", {
        title: "Conference",
        date: "2026-09-21T10:00:00.000Z",
        totalSeats: 10
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "availableSeats cannot exceed totalSeats"
    });
  });

  it("throws not found when update or delete misses a record", async () => {
    repository.update.mockResolvedValue(null);
    repository.delete.mockResolvedValue(false);

    await expect(
      service.updateEvent("event-1", {
        title: "Conference",
        date: "2026-09-21T10:00:00.000Z",
        totalSeats: 10
      })
    ).rejects.toMatchObject({
      code: "EVENT_NOT_FOUND"
    });

    await expect(service.deleteEvent("event-1")).rejects.toMatchObject({
      code: "EVENT_NOT_FOUND"
    });
  });
});
