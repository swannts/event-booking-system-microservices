import type { EventCache } from "../../infrastructure/cache/event.cache";
import type { MessagePublisher } from "../../infrastructure/messaging/message-publisher";
import type { EventRepository } from "../events/event.repository";

export type InventoryDependencies = {
  repository: EventRepository;
  cache: EventCache;
  publisher: MessagePublisher;
};
