import type { Event as EventModel } from "../../../generated/prisma";

export type EventRecord = EventModel;

export type EventDto = {
  id: string;
  title: string;
  date: string;
  totalSeats: number;
  availableSeats: number;
  createdAt: string;
  updatedAt: string;
};

export type EventDatabaseClient = {
  event: {
    create(input: { data: { id: string; title: string; date: Date; totalSeats: number; availableSeats: number } }): Promise<EventRecord>;
    findUnique(input: { where: { id: string } }): Promise<EventRecord | null>;
    findMany(input?: { orderBy?: { createdAt?: "asc" | "desc" } }): Promise<EventRecord[]>;
    update(input: {
      where: { id: string };
      data: {
        title?: string;
        date?: Date;
        totalSeats?: number;
        availableSeats?: number;
      };
    }): Promise<EventRecord>;
    deleteMany(input: { where: { id: string } }): Promise<{ count: number }>;
    updateMany(input: {
      where: { id: string; availableSeats?: { gte: number } };
      data: {
        availableSeats?: { decrement?: number; increment?: number };
        updatedAt?: Date;
      };
    }): Promise<{ count: number }>;
  };
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
};

export interface EventRepository {
  create(input: {
    id: string;
    title: string;
    date: string;
    totalSeats: number;
    availableSeats?: number;
  }): Promise<EventDto>;
  findById(id: string): Promise<EventDto | null>;
  list(): Promise<EventDto[]>;
  update(
    id: string,
    input: { title: string; date: string; totalSeats: number }
  ): Promise<EventDto | null>;
  delete(id: string): Promise<boolean>;
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

  async list(): Promise<EventDto[]> {
    const events = await this.db.event.findMany({ orderBy: { createdAt: "asc" } });
    return events.map(mapRow);
  }

  async update(
    id: string,
    input: { title: string; date: string; totalSeats: number }
  ): Promise<EventDto | null> {
    const current = await this.db.event.findUnique({ where: { id } });
    if (!current) {
      return null;
    }

    const reservedSeats = current.totalSeats - current.availableSeats;
    if (input.totalSeats < reservedSeats) {
      throw new Error("AVAILABLE_SEATS_CANNOT_EXCEED_TOTAL_SEATS");
    }

    const event = await this.db.event.update({
      where: { id },
      data: {
        title: input.title,
        date: new Date(input.date),
        totalSeats: input.totalSeats,
        availableSeats: input.totalSeats - reservedSeats
      }
    });

    return mapRow(event);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.event.deleteMany({ where: { id } });
    return result.count > 0;
  }
}
