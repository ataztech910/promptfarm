import { Command } from "commander";
import path from "node:path";
import { loadConfig } from "../../core/config.js";
import { loadPromptFiles } from "../../core/load.js";
import { validateLoadedPrompts } from "../../core/validate.js";
import { printDebug } from "../debug.js";

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
    const res = validateLoadedPrompts(files);

    if (res.issues.length) {
      console.error(`❌ Validation failed (${res.issues.length} issues):`);
      for (const i of res.issues) console.error(`- ${i.filepath}: ${i.message}`);
      process.exitCode = 1;
      return;
    }

    console.log(`✅ OK. Valid prompts: ${res.prompts.length}`);
  });

  return c;
}
