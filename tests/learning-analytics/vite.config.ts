import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
const root = process.cwd();
const mock = path.join(root, "tests/learning-analytics/browser-mocks.ts");
export default defineConfig({
  root,
  optimizeDeps: { entries: ["tests/learning-analytics/browser.html"] },
  plugins: [react()],
  resolve: {
    alias: {
      "@/lib/supabaseClient": mock,
      "@/queries/adminPermissions": mock,
      "@/queries/userManagement": mock,
      "@": path.join(root, "src"),
    },
  },
  server: { host: "127.0.0.1", port: 5182 },
});
