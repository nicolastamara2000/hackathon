import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Served by FastAPI at / (see src/matchcopilot/api/app.py); `npm run dev` proxies /api to it.
// The GitHub Pages build sets VITE_BASE=/hackathon/ and VITE_STATIC=1 (see .github/workflows/pages.yml).
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8000" } },
  build: { outDir: "dist", chunkSizeWarningLimit: 1500 },
});
