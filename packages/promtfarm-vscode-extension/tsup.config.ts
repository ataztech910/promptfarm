import { defineConfig } from "tsup";

export default defineConfig({
  entry: { extension: "src/extension.ts" },
  format: ["cjs"],
  target: "es2020",
  sourcemap: true,
  clean: true,
  outDir: "dist",
  external: ["vscode"],
  noExternal: ["@promptfarm/editor-core"],
});
