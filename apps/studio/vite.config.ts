import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const studioApiProxyTarget = process.env.PROMPTFARM_STUDIO_API_PROXY_TARGET?.trim() || "http://127.0.0.1:4310";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@promptfarm/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
    },
  },
  server: {
    fs: {
      allow: [".."],
    },
    proxy: {
      "/api": {
        target: studioApiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
