import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./supabase/functions/_shared"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    env: loadEnv(mode, process.cwd(), "VITE_"),
    // Los tests comparten estado global (rate limits, misma IP): se ejecutan en serie.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
}));
