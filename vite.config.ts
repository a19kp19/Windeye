import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  base: "./",
  worker: { format: "es" },
  // Keep Vite's defaults: localhost only, Host header checked. The managed preview passes --host itself
  // and allow-lists its proxy domain through __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS.
  server: { port: 5173, strictPort: true },
  preview: { port: 4173 },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
