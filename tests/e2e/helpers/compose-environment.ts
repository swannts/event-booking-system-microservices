import { execFileSync } from "child_process";

const ROOT_DIR = process.cwd();
const COMPOSE_CMD = ["compose"];

export function compose(args: string[], options: { stdio?: "pipe" | "inherit" | "ignore" } = {}) {
  const output = execFileSync("docker", [...COMPOSE_CMD, ...args], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe"
  });

  return typeof output === "string" ? output.trim() : "";
}

export async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  stepMs = 1000,
  failureMessage = "Operation timed out"
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }

  throw new Error(failureMessage);
}

export async function waitForHealth(port: number, timeoutMs = 180000): Promise<void> {
  const url = `http://127.0.0.1:${port}/health/ready`;
  await waitFor(
    async () => {
      try {
        const response = await fetch(url);
        return response.ok;
      } catch {
        return false;
      }
    },
    timeoutMs,
    1000,
    `Timed out waiting for health check at ${url}`
  );
}

export async function waitForComposeServiceHealth(service: string, command: string[], timeoutMs = 180000): Promise<void> {
  await waitFor(
    async () => {
      try {
        const output = compose(["exec", "-T", service, ...command]);
        return output.length >= 0;
      } catch {
        return false;
      }
    },
    timeoutMs,
    2000,
    `Timed out waiting for Docker Compose service '${service}' health check`
  );
}

export async function prepareE2ECluster(): Promise<void> {
  compose(["down", "-v", "--remove-orphans"]);
  compose(["up", "-d", "--build"]);
  await waitForComposeServiceHealth("user-db", ["pg_isready", "-U", "postgres", "-d", "event_booking"]);
  await waitForComposeServiceHealth("event-db", ["pg_isready", "-U", "postgres", "-d", "event_booking"]);
  await waitForComposeServiceHealth("booking-db", ["pg_isready", "-U", "postgres", "-d", "event_booking"]);
  await waitForComposeServiceHealth("redis", ["redis-cli", "ping"]);

  await Promise.all([
    waitForHealth(3000),
    waitForHealth(3001),
    waitForHealth(3002),
    waitForHealth(3003)
  ]);
}
