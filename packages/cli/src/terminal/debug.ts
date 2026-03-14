import type { ResolvedConfig } from "@promptfarm/core/node";

type DebugContext = {
  matchedFiles?: number;
  command?: string;
};

export function printDebug(cfg: ResolvedConfig, ctx: DebugContext = {}): void {
  const rows: Record<string, string | number | boolean> = {
    command: ctx.command ?? "(unknown)",
    cwd: cfg.cwdAbs,
    configPath: cfg.configPath,
    configFound: cfg.configFound,
    promptsDirAbs: cfg.promptsDirAbs,
    testsDirAbs: cfg.testsDirAbs,
    distDirAbs: cfg.distDirAbs,
    promptGlobAbs: cfg.promptGlobAbs,
    testGlobAbs: cfg.testGlobAbs,
  };

  if (typeof ctx.matchedFiles === "number") {
    rows.matchedFiles = ctx.matchedFiles;
  }

  for (const [k, v] of Object.entries(rows)) {
    console.error(`[promptfarm:debug] ${k}=${v}`);
  }
}
