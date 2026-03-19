import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm"],
  target: "es2020",
  sourcemap: true,
  dts: true,
  clean: true,
  outDir: "dist",
  external: ["react"],
});
