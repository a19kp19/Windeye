import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  base: "./",
  worker: { format: "es" },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // The managed preview is served through a proxy hostname.
    allowedHosts: true,
  },
  preview: { host: "0.0.0.0", port: 4173, allowedHosts: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
