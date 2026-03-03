import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli/index.ts"], // твой вход
  format: ["cjs"],
  platform: "node",
  target: "node18", // или node20
  sourcemap: true,
  clean: true,
  outDir: "dist",
});