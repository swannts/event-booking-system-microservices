import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createRedisRateLimiter } from "../../src/middleware/rate-limiter";

function createApp(options: Parameters<typeof createRedisRateLimiter>[0], trustProxy: boolean | number = false) {
  const app = express();
  app.set("trust proxy", trustProxy);
  app.use(createRedisRateLimiter(options));
  app.get("/resource", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("fixed-window rate limiter", () => {
  it("uses one atomic Redis Lua command and rejects over the limit", async () => {
    const redis = {
      isOpen: true,
      eval: vi.fn().mockResolvedValueOnce([1, 60]).mockResolvedValueOnce([2, 59])
    };
    const app = createApp({ maxRequests: 1, redisClient: redis as never });

    await request(app).get("/resource").expect(200);
    await request(app).get("/resource").expect(429);

    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(redis.eval.mock.calls[0]?.[0]).toContain("INCR");
    expect(redis.eval.mock.calls[0]?.[0]).toContain("EXPIRE");
  });

  it("starts a new in-memory window after expiry", async () => {
    const app = createApp({ maxRequests: 1, windowSeconds: 1 });
    await request(app).get("/resource").expect(200);
    await request(app).get("/resource").expect(429);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await request(app).get("/resource").expect(200);
  });

  it("keeps limiting through bounded in-memory fallback when Redis fails", async () => {
    const redis = { isOpen: true, eval: vi.fn().mockRejectedValue(new Error("redis unavailable")) };
    const app = createApp({ maxRequests: 1, redisClient: redis as never, maxFallbackEntries: 1 }, 1);

    await request(app).get("/resource").set("X-Forwarded-For", "203.0.113.1").expect(200);
    await request(app).get("/resource").set("X-Forwarded-For", "203.0.113.1").expect(429);
    await request(app).get("/resource").set("X-Forwarded-For", "203.0.113.2").expect(200);
    await request(app).get("/resource").set("X-Forwarded-For", "203.0.113.1").expect(200);
  });
});
