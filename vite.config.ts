import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The web app lives in /web; API calls are proxied to the Express server on :8787.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    // emit to a project-root /dist that the Express server serves in production
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
