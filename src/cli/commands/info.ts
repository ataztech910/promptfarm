import { Command } from "commander";
import path from "node:path";
import { loadPromptFiles } from "../../core/load.js";
import { validateLoadedPrompts } from "../../core/validate.js";
import { extractUsedVars } from "../../core/inputs.js";

export function cmdInfo(): Command {
  const c = new Command("info")
    .description("Show prompt metadata, inputs, and used template variables")
    .argument("<id>", "Prompt id")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--pattern <glob>", "Glob pattern", "prompts/**/*.prompt.yaml");

  c.action(async (id: string, opts) => {
    const cwd = path.resolve(opts.cwd);
    const files = await loadPromptFiles({ cwd, pattern: opts.pattern });
    const res = validateLoadedPrompts(files);

    if (res.issues.length) {
      console.error(`❌ Validation failed. Run: promptfarm validate`);
      process.exitCode = 1;
      return;
    }

    const entry = res.prompts.find((p) => p.prompt.id === id);
    if (!entry) {
      console.error(`❌ Prompt not found: ${id}`);
      console.error(`Available: ${res.prompts.map((p) => p.prompt.id).join(", ")}`);
      process.exitCode = 1;
      return;
    }

    const p = entry.prompt;
    const used = Array.from(extractUsedVars(p)).sort();

    console.log(`${p.id} — ${p.title}`);
    console.log(`version: ${p.version}`);
    if (p.tags?.length) console.log(`tags: ${p.tags.join(", ")}`);
    console.log(`file: ${entry.filepath}`);
    console.log("");

    const inputs = p.inputs ?? {};
    const keys = Object.keys(inputs).sort();

    console.log("inputs:");
    if (!keys.length) {
      console.log("  (none)");
    } else {
      for (const k of keys) {
        const spec = inputs[k]!;
        const req = spec!.required ? "required" : "optional";
        console.log(`  - ${k} (${spec!.type}, ${req})${spec!.description ? ` — ${spec!.description}` : ""}`);
      }
    }

    console.log("");
    console.log("template variables used:");
    console.log(used.length ? `  ${used.join(", ")}` : "  (none)");
  });

  return c;
}