import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/main.ts",
  },
  format: ["cjs"],
  platform: "node",
  target: "node18",
  sourcemap: true,
  clean: true,
  outDir: "dist",
  noExternal: ["@promptfarm/core"]
});
