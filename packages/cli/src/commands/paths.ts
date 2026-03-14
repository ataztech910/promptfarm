import { Command } from "commander";
import path from "node:path";
import { loadConfig } from "@promptfarm/core/node";

export function cmdPaths(): Command {
  const c = new Command("paths")
    .description("Print resolved config paths and globs")
    .option("--cwd <path>", "Project root", process.cwd());

  c.action(async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const cfg = await loadConfig(cwd);

    console.log(`cwd: ${cfg.cwdAbs}`);
    console.log(`config: ${cfg.configPath}${cfg.configFound ? "" : " (not found; defaults applied)"}`);
    console.log(`promptsDir: ${cfg.promptsDirAbs}`);
    console.log(`testsDir: ${cfg.testsDirAbs}`);
    console.log(`distDir: ${cfg.distDirAbs}`);
    console.log(`promptGlob: ${cfg.promptGlobAbs}`);
    console.log(`testGlob: ${cfg.testGlobAbs}`);
  });

  return c;
}
