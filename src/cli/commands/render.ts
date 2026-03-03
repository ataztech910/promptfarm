import { Command } from "commander";
import path from "node:path";
import { loadPromptFiles } from "../../core/load.js";
import { validateLoadedPrompts } from "../../core/validate.js";
import { renderOpenAIBundle } from "../../core/render/openai.js";
import { renderGeneric } from "../../core/render/generic.js";
import type { TemplateVars } from "../../core/template.js";
import { checkInputs } from "../../core/inputs.js";

function parseSet(values: string[] | undefined): TemplateVars {
  const vars: TemplateVars = {};
  for (const item of values ?? []) {
    const eq = item.indexOf("=");
    if (eq <= 0) continue;
    const k = item.slice(0, eq).trim();
    const v = item.slice(eq + 1).trim();
    vars[k] = v;
  }
  return vars;
}

export function cmdRender(): Command {
  const c = new Command("render")
    .description("Render a prompt by id")
    .argument("<id>", "Prompt id")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--pattern <glob>", "Glob pattern", "prompts/**/*.prompt.yaml")
    .option("--target <target>", "Render target: generic|openai", "openai")
    .option("--set <k=v...>", "Template variable (repeatable)", (v, acc: string[]) => {
      acc.push(v);
      return acc;
    }, []);

  c.action(async (id: string, opts) => {
    const cwd = path.resolve(opts.cwd);
    const files = await loadPromptFiles({ cwd, pattern: opts.pattern });
    const res = validateLoadedPrompts(files);

    if (res.issues.length) {
      console.error(`❌ Validation failed. Run: promptfarm validate`);
      process.exitCode = 1;
      return;
    }

    const found = res.prompts.find((p) => p.prompt.id === id)?.prompt;
    if (!found) {
      console.error(`❌ Prompt not found: ${id}`);
      console.error(`Available: ${res.prompts.map((p) => p.prompt.id).join(", ")}`);
      process.exitCode = 1;
      return;
    }

    const vars = parseSet(opts.set);

    const checks = checkInputs(found, vars);

    if (checks.usedButNotDeclared.length) {
      console.error(
        `❌ Template uses variables not declared in inputs: ${checks.usedButNotDeclared.join(", ")}`
      );
      console.error(`Declare them under "inputs:" in the prompt YAML.`);
      process.exitCode = 1;
      return;
    }

    if (checks.unknownProvided.length) {
      console.error(`❌ Unknown inputs provided: ${checks.unknownProvided.join(", ")}`);
      console.error(`Allowed inputs: ${Object.keys(found.inputs ?? {}).join(", ") || "(none)"}`);
      process.exitCode = 1;
      return;
    }

    if (checks.missingRequired.length) {
      console.error(`❌ Missing required inputs: ${checks.missingRequired.join(", ")}`);
      console.error(`Provide them via --set key=value`);
      process.exitCode = 1;
      return;
    }

    const out =
      opts.target === "generic"
        ? renderGeneric(found, vars)
        : renderOpenAIBundle(found, vars);

    process.stdout.write(out);
  });

  return c;
}