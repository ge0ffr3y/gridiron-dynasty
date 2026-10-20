import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "pipeline/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    // Simulation tests play whole seasons; CI machines are slower than a laptop.
    testTimeout: 30_000,
  },
});
