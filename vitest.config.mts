import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    exclude: ["**/node_modules/**", "**/dist/**", "**/tests/e2e/**", "**/.worktrees/**"],
  },
  resolve: {
    alias: {
      "@": resolve(process.cwd(), "src"),
    },
  },
});
