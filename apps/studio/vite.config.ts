import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

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
  },
});
