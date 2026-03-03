import { Command } from "commander";
import path from "node:path";
import { loadPromptFiles } from "../../core/load";
import { validateLoadedPrompts } from "../../core/validate";

export function cmdValidate(): Command {
  const c = new Command("validate")
    .description("Validate prompts against schema and project rules")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--pattern <glob>", "Glob pattern", "prompts/**/*.prompt.yaml");

  c.action(async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const files = await loadPromptFiles({ cwd, pattern: opts.pattern });
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