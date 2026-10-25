import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Served by FastAPI under /app (see src/matchcopilot/api/app.py).
export default defineConfig({
  base: "/app/",
  plugins: [react()],
  build: { outDir: "dist", chunkSizeWarningLimit: 1500 },
});
