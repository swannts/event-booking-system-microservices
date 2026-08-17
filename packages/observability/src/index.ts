import type { NextFunction, Request, Response } from "express";
import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry, prefix: "event_booking_" });

const httpRequests = new Counter({
  name: "event_booking_http_requests_total",
  help: "HTTP requests handled",
  labelNames: ["service", "method", "status"] as const,
  registers: [metricsRegistry]
});
const httpDuration = new Histogram({
  name: "event_booking_http_request_duration_seconds",
  help: "HTTP request duration",
  labelNames: ["service", "method"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [metricsRegistry]
});
export const domainEvents = new Counter({
  name: "event_booking_domain_events_total",
  help: "Business and infrastructure outcomes",
  labelNames: ["service", "operation", "outcome"] as const,
  registers: [metricsRegistry]
});

export function observeDomain(service: string, operation: string, outcome: string): void {
  domainEvents.inc({ service, operation, outcome });
}

export function httpMetrics(service: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const stop = httpDuration.startTimer({ service, method: req.method });
    res.once("finish", () => {
      stop();
      httpRequests.inc({ service, method: req.method, status: `${Math.floor(res.statusCode / 100)}xx` });
    });
    next();
  };
}

export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.setHeader("Content-Type", metricsRegistry.contentType);
  res.send(await metricsRegistry.metrics());
}

export function readinessHandler(checks: Record<string, () => Promise<void>>) {
  return async (_req: Request, res: Response): Promise<void> => {
    const entries = await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          await check();
          return [name, "ok"] as const;
        } catch {
          return [name, "failed"] as const;
        }
      })
    );
    const result = Object.fromEntries(entries);
    const ready = entries.every(([, status]) => status === "ok");
    res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready", checks: result });
  };
}
