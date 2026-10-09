import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // Proxy /go-api/internal/* → http://localhost:8080/internal/*
      // Must be declared BEFORE the generic /go-api rule so Vite matches it
      // first (first-match wins). Internal endpoints (e.g. /internal/feature-flags)
      // are NOT under /v1, so they must NOT get the /v1 prefix rewrite.
      "/go-api/internal": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/go-api/, ""),
      },
      // Proxy /go-api/api/* → http://localhost:8080/api/* for reupload endpoint
      // The reupload route is /api/v1/instructor/... (different from others which use /v1/admin/instructors/...)
      // Must be declared BEFORE the generic /go-api rule so Vite matches it first
      "/go-api/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/go-api/, ""),
      },
      // Proxy /go-api/* → http://localhost:8080/v1/* during local dev.
      // This avoids browser CORS errors when calling the Go service.
      // In production, VITE_BACKEND_API is set to the real Go service base URL
      // (e.g. https://api.inlane.in/v1) so the proxy is not used.
      "/go-api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/go-api/, "/v1"),
      },
    },
  },
});
