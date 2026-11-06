import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "scripts/**/*.test.mjs",
      "test-support/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
    // El primer test de cada archivo paga la carga de módulos; con la máquina ocupada (CI compartido, varios
    // procesos) 5 s no alcanzaban y las pruebas fallaban por tiempo sin tener un defecto. Subir el tope no ralentiza a
    // nadie: solo deja de fallar a quien tarda un poco más.
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./supabase/functions/_shared"),
    },
  },
});
