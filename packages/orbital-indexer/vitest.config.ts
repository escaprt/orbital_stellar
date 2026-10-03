import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // src/index.ts is a barrel re-export - no statements of its own.
      exclude: ["node_modules/", "dist/", "test/", "**/*.test.ts", "**/*.config.*", "src/index.ts"],
      // Raised from the post-#933 baseline (74/48/83/79) now that #1247's
      // unit tests drive the live-registry paths - republish rejection,
      // sequence-collision retry and event-driven backoff - with a stubbed
      // RPC and fake timers, so the default run reaches 100% without
      // INTEGRATION_TESTS being set. Kept a notch under 100 so a new
      // branch doesn't fail CI on the same PR that adds it.
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
      reporter: ["text", "html", "json-summary"],
    },
  },
  resolve: {
    alias: {
      "@orbital-stellar/pulse-core": fileURLToPath(
        new URL("../pulse-core/src/index.ts", import.meta.url),
      ),
      "@orbital-stellar/abi-registry": fileURLToPath(
        new URL("../abi-registry/src/index.ts", import.meta.url),
      ),
    },
  },
});
