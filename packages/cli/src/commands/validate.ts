import { Command } from "commander";
import path from "node:path";
import { loadConfig } from "@promptfarm/core/node";
import { loadPromptFiles } from "@promptfarm/core/node";
import { resolveAllRuntimeFromFiles } from "@promptfarm/core";
import { printDebug } from "../terminal/debug.js";

export function cmdValidate(): Command {
  const c = new Command("validate")
    .description("Validate prompts against schema and project rules")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--debug", "Print resolved config/paths");

  c.action(async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const cfg = await loadConfig(cwd);
    const files = await loadPromptFiles({ patternAbs: cfg.promptGlobAbs });
    if (opts.debug) printDebug(cfg, { command: "validate", matchedFiles: files.length });
    const res = resolveAllRuntimeFromFiles(files, cwd);

    if (res.issues.length) {
      console.error(`❌ Validation failed (${res.issues.length} issues):`);
      for (const i of res.issues) console.error(`- ${i.filepath}: ${i.message}`);
      process.exitCode = 1;
      return;
    }

    console.log(`✅ OK. Valid prompts: ${res.contexts.length}`);
  });

  return c;
}
