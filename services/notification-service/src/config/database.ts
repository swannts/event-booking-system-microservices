import { PrismaClient } from "../../generated/prisma";

export type NotificationDatabase = PrismaClient;

export function createNotificationDatabase(connectionString: string): NotificationDatabase {
  return new PrismaClient({ datasources: { db: { url: connectionString } } });
}
