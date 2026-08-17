import { Prisma } from "../../../generated/prisma";
import type {
  CreateEventInput,
  EventDatabaseClient,
  EventDto,
  EventRecord,
  EventRepository,
  UpdateEventInput
} from "./event.types";

export type { CreateEventInput, EventDatabaseClient, EventDto, EventRecord, EventRepository, UpdateEventInput };

export class CapacityBelowReservedSeatsError extends Error {
  constructor() {
    super("Event capacity cannot be lower than the number of reserved seats");
    this.name = "CapacityBelowReservedSeatsError";
  }
}

function mapRow(row: EventRecord): EventDto {
  return {
    id: row.id,
    title: row.title,
    date: row.date.toISOString(),
    totalSeats: row.totalSeats,
    availableSeats: row.availableSeats,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export class PrismaEventRepository implements EventRepository {
  constructor(private readonly db: EventDatabaseClient) {}

  async create(input: {
    id: string;
    title: string;
    date: string;
    totalSeats: number;
    availableSeats?: number;
  }): Promise<EventDto> {
    const event = await this.db.event.create({
      data: {
        id: input.id,
        title: input.title,
        date: new Date(input.date),
        totalSeats: input.totalSeats,
        availableSeats: input.availableSeats ?? input.totalSeats
      }
    });

    return mapRow(event);
  }

  async findById(id: string): Promise<EventDto | null> {
    const event = await this.db.event.findUnique({ where: { id } });
    return event ? mapRow(event) : null;
  }

  async list({ page, pageSize }: { page: number; pageSize: number } = { page: 1, pageSize: 20 }): Promise<EventDto[]> {
    const events = await this.db.event.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
    });
    return events.map(mapRow);
  }

  async update(id: string, input: { title: string; date: string; totalSeats: number }): Promise<EventDto | null> {
    const rows = await this.db.$queryRaw<EventRecord[]>(Prisma.sql`
      UPDATE events
      SET title = ${input.title},
          date = ${new Date(input.date)},
          available_seats = ${input.totalSeats} - (total_seats - available_seats),
          total_seats = ${input.totalSeats},
          updated_at = NOW()
      WHERE id = ${id}::uuid
        AND ${input.totalSeats} >= total_seats - available_seats
      RETURNING
        id,
        title,
        date,
        total_seats AS "totalSeats",
        available_seats AS "availableSeats",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `);

    if (rows[0]) {
      return mapRow(rows[0]);
    }

    const current = await this.db.event.findUnique({ where: { id } });
    if (current) {
      throw new CapacityBelowReservedSeatsError();
    }

    return null;
  }

  async delete(id: string): Promise<"DELETED" | "NOT_FOUND" | "HAS_RESERVATIONS"> {
    const deleted = await this.db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      DELETE FROM events
      WHERE id = ${id}::uuid AND available_seats = total_seats
      RETURNING id
    `);
    if (deleted[0]) return "DELETED";
    return (await this.db.event.findUnique({ where: { id } })) ? "HAS_RESERVATIONS" : "NOT_FOUND";
  }
}
