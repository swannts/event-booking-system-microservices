import type { Request, Response, NextFunction } from "express";
import type { EventRedisClient } from "../config/redis";
import { observeDomain } from "@event-booking/observability";

export interface RateLimiterOptions {
  windowSeconds?: number;
  maxRequests?: number;
  redisClient?: EventRedisClient;
  maxFallbackEntries?: number;
}

const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return { count, redis.call('TTL', KEYS[1]) }
`;

export function createRedisRateLimiter(options: RateLimiterOptions = {}) {
  const windowSeconds = options.windowSeconds ?? 60;
  const maxRequests = options.maxRequests ?? 100;
  const maxFallbackEntries = options.maxFallbackEntries ?? 10_000;
  const inMemoryStore = new Map<string, { count: number; resetAt: number }>();

  function consumeFallback(key: string, now: number) {
    for (const [storedKey, entry] of inMemoryStore) {
      if (entry.resetAt <= now) {
        inMemoryStore.delete(storedKey);
      }
    }
    let entry = inMemoryStore.get(key);
    if (!entry) {
      if (inMemoryStore.size >= maxFallbackEntries) {
        const oldestKey = inMemoryStore.keys().next().value as string | undefined;
        if (oldestKey) inMemoryStore.delete(oldestKey);
      }
      entry = { count: 0, resetAt: now + windowSeconds };
      inMemoryStore.set(key, entry);
    }
    entry.count += 1;
    return { requests: entry.count, ttl: Math.max(1, entry.resetAt - now), resetAt: entry.resetAt };
  }

  function respond(requests: number, ttl: number, resetAt: number, res: Response): boolean {
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - requests));
    res.setHeader("X-RateLimit-Reset", resetAt);
    if (requests <= maxRequests) return false;

    observeDomain("event-service", "rate_limit", "rejected");
    res.setHeader("Retry-After", ttl);
    res.status(429).json({
      error: "Too Many Requests",
      message: `Rate limit exceeded. Maximum ${maxRequests} requests per ${windowSeconds} seconds.`,
      retryAfter: ttl
    });
    return true;
  }

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = req.ip || req.socket.remoteAddress || "127.0.0.1";
    const key = `rate_limit:${ip}:${req.baseUrl || ""}${req.path}`;
    const now = Math.floor(Date.now() / 1000);

    let requests: number;
    let ttl: number;
    let resetAt: number;
    try {
      if (options.redisClient && options.redisClient.isOpen) {
        const result = (await options.redisClient.eval(FIXED_WINDOW_SCRIPT, {
          keys: [key],
          arguments: [String(windowSeconds)]
        })) as [number, number];
        requests = Number(result[0]);
        ttl = Number(result[1]) > 0 ? Number(result[1]) : windowSeconds;
        resetAt = now + ttl;
      } else {
        ({ requests, ttl, resetAt } = consumeFallback(key, now));
      }
    } catch {
      ({ requests, ttl, resetAt } = consumeFallback(key, now));
    }

    if (!respond(requests, ttl, resetAt, res)) next();
  };
}
