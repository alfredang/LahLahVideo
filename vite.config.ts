import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port and leaves the terminal output alone.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/topic-to-video/**"] } },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2021", sourcemap: false, chunkSizeWarningLimit: 1500 },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
} as any);
