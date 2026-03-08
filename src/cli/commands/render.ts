import { Command } from "commander";
import path from "node:path";
import { loadConfig } from "../../core/config.js";
import { loadPromptFiles } from "../../core/load.js";
import { validateLoadedPrompts } from "../../core/validate.js";
import { renderOpenAIBundle } from "../../core/render/openai.js";
import { renderGeneric } from "../../core/render/generic.js";
import type { TemplateVars } from "../../core/template.js";
import { checkInputs } from "../../core/inputs.js";
import { resolvePromptComposition } from "../../core/compose.js";
import { printDebug } from "../debug.js";

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
    .option("--target <target>", "Render target: generic|openai", "openai")
    .option("--debug", "Print resolved config/paths")
    .option("--set <k=v...>", "Template variable (repeatable)", (v, acc: string[]) => {
      acc.push(v);
      return acc;
    }, []);

  c.action(async (id: string, opts) => {
    const cwd = path.resolve(opts.cwd);
    const cfg = await loadConfig(cwd);
    const files = await loadPromptFiles({ patternAbs: cfg.promptGlobAbs });
    if (opts.debug) printDebug(cfg, { command: "render", matchedFiles: files.length });
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

    let resolvedPrompt = found;
    try {
      resolvedPrompt = resolvePromptComposition(
        found.id,
        res.prompts.map(({ prompt, filepath }) => ({ prompt, filepath })),
      ).prompt;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`❌ ${message}`);
      process.exitCode = 1;
      return;
    }

    const vars = parseSet(opts.set);

    const checks = checkInputs(resolvedPrompt, vars);

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
      console.error(`Allowed inputs: ${Object.keys(resolvedPrompt.inputs ?? {}).join(", ") || "(none)"}`);
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
        ? renderGeneric(resolvedPrompt, vars)
        : renderOpenAIBundle(resolvedPrompt, vars);

    process.stdout.write(out);
  });

  return c;
}
