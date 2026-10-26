import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Served by FastAPI at / (see src/matchcopilot/api/app.py); `npm run dev` proxies /api to it.
export default defineConfig({
  base: "/",
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8000" } },
  build: { outDir: "dist", chunkSizeWarningLimit: 1500 },
});
