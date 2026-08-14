import type { Request, Response, NextFunction } from "express";
import type { EventRedisClient } from "../config/redis";

export interface RateLimiterOptions {
  windowSeconds?: number;
  maxRequests?: number;
  redisClient?: EventRedisClient;
}

export function createRedisRateLimiter(options: RateLimiterOptions = {}) {
  const windowSeconds = options.windowSeconds ?? 60;
  const maxRequests = options.maxRequests ?? 100;
  const inMemoryStore = new Map<string, { count: number; resetAt: number }>();

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = req.ip || req.socket.remoteAddress || "127.0.0.1";
    const key = `rate_limit:${ip}:${req.baseUrl || ""}${req.path}`;
    const now = Math.floor(Date.now() / 1000);

    try {
      if (options.redisClient && options.redisClient.isOpen) {
        const requests = await options.redisClient.incr(key);
        if (requests === 1) {
          await options.redisClient.expire(key, windowSeconds);
        }
        const ttl = await options.redisClient.ttl(key);

        res.setHeader("X-RateLimit-Limit", maxRequests);
        res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - requests));
        res.setHeader("X-RateLimit-Reset", now + (ttl > 0 ? ttl : windowSeconds));

        if (requests > maxRequests) {
          res.setHeader("Retry-After", ttl > 0 ? ttl : windowSeconds);
          res.status(429).json({
            error: "Too Many Requests",
            message: `Rate limit exceeded. Maximum ${maxRequests} requests per ${windowSeconds} seconds.`,
            retryAfter: ttl > 0 ? ttl : windowSeconds
          });
          return;
        }
      } else {
        // Fallback in-memory rate limiter if Redis is disconnected
        const entry = inMemoryStore.get(key);
        if (!entry || entry.resetAt <= now) {
          inMemoryStore.set(key, { count: 1, resetAt: now + windowSeconds });
          res.setHeader("X-RateLimit-Limit", maxRequests);
          res.setHeader("X-RateLimit-Remaining", maxRequests - 1);
          res.setHeader("X-RateLimit-Reset", now + windowSeconds);
        } else {
          entry.count += 1;
          const remaining = Math.max(0, maxRequests - entry.count);
          const ttl = Math.max(1, entry.resetAt - now);

          res.setHeader("X-RateLimit-Limit", maxRequests);
          res.setHeader("X-RateLimit-Remaining", remaining);
          res.setHeader("X-RateLimit-Reset", entry.resetAt);

          if (entry.count > maxRequests) {
            res.setHeader("Retry-After", ttl);
            res.status(429).json({
              error: "Too Many Requests",
              message: `Rate limit exceeded. Maximum ${maxRequests} requests per ${windowSeconds} seconds.`,
              retryAfter: ttl
            });
            return;
          }
        }
      }
      next();
    } catch {
      // Graceful fallback: allow request if rate limiter errors out
      next();
    }
  };
}
