import { defineConfig } from "vitest/config";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: rootDir,
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.spec.ts", "tests/e2e/**/*.test.ts"],
    testTimeout: 300000,
    hookTimeout: 300000,
    fileParallelism: false
  }
});
