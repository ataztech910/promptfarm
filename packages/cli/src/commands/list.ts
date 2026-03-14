import { Command } from "commander";
import path from "node:path";
import { loadConfig } from "@promptfarm/core/node";
import { loadPromptFiles } from "@promptfarm/core/node";
import { resolveAllRuntimeFromFiles } from "@promptfarm/core";
import { printDebug } from "../terminal/debug.js";

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
    const res = resolveAllRuntimeFromFiles(files, cwd);

    if (res.issues.length) {
      console.error(`❌ Validation failed (${res.issues.length} issues). Run: promptfarm validate`);
      process.exitCode = 1;
      return;
    }

    for (const context of res.contexts) {
      const tags = context.sourcePrompt.metadata.tags?.length
        ? ` [${context.sourcePrompt.metadata.tags.join(", ")}]`
        : "";
      const title = context.sourcePrompt.metadata.title ?? context.sourcePrompt.metadata.id;
      console.log(`${context.sourcePrompt.metadata.id} — ${title}${tags}`);
    }
  });

  return c;
}
