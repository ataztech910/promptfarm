import { Command } from "commander";
import path from "node:path";
import { loadConfig } from "../../core/config.js";
import { loadPromptFiles } from "../../core/load.js";
import { validateLoadedPrompts } from "../../core/validate.js";
import { printDebug } from "../debug.js";

export function cmdList(): Command {
  const c = new Command("list")
    .description("List prompts (id, title, tags)")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--debug", "Print resolved config/paths");

  c.action(async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const cfg = await loadConfig(cwd);
    const files = await loadPromptFiles({ patternAbs: cfg.promptGlobAbs });
    if (opts.debug) printDebug(cfg, { command: "list", matchedFiles: files.length });
    const res = validateLoadedPrompts(files);

    if (res.issues.length) {
      console.error(`❌ Validation failed (${res.issues.length} issues). Run: promptfarm validate`);
      process.exitCode = 1;
      return;
    }

    for (const { prompt } of res.prompts) {
      const tags = prompt.tags?.length ? ` [${prompt.tags.join(", ")}]` : "";
      console.log(`${prompt.id} — ${prompt.title}${tags}`);
    }
  });

  return c;
}
