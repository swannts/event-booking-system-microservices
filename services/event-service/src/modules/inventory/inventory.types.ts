import type { EventCache } from "../../infrastructure/cache/event-cache";
import type { MessagePublisher } from "../../infrastructure/messaging/message-publisher";
import type { InventoryRepository } from "./inventory.repository";

export type InventoryDependencies = {
  repository: InventoryRepository;
  cache: EventCache;
  publisher: MessagePublisher;
};
