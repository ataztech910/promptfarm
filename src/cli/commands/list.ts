import { Command } from "commander";
import path from "node:path";
import { loadPromptFiles } from "../../core/load";
import { validateLoadedPrompts } from "../../core/validate";

export function cmdList(): Command {
  const c = new Command("list")
    .description("List prompts (id, title, tags)")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--pattern <glob>", "Glob pattern", "prompts/**/*.prompt.yaml");

  c.action(async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const files = await loadPromptFiles({ cwd, pattern: opts.pattern });
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