import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node18",
  sourcemap: true,
  dts: true,
  clean: true,
  outDir: "dist",
});
