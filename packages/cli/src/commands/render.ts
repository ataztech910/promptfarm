import { Command } from "commander";
import path from "node:path";
import { loadConfig } from "@promptfarm/core/node";
import { loadPromptFiles } from "@promptfarm/core/node";
import type { TemplateVars } from "@promptfarm/core";
import { resolveAllRuntimeFromFiles } from "@promptfarm/core";
import { renderRuntimePrompt } from "@promptfarm/core";
import type { LegacyPrompt } from "@promptfarm/core";
import { printDebug } from "../terminal/debug.js";

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
    const runtime = resolveAllRuntimeFromFiles(files, cwd);

    if (runtime.issues.length) {
      console.error(`❌ Validation failed (${runtime.issues.length} issues):`);
      for (const issue of runtime.issues) {
        console.error(`- ${issue.filepath}: ${issue.message}`);
      }
      process.exitCode = 1;
      return;
    }

    const found = runtime.contexts.find((context) => context.promptId === id);
    if (!found) {
      console.error(`❌ Prompt not found: ${id}`);
      console.error(`Available: ${runtime.contexts.map((context) => context.promptId).join(", ")}`);
      process.exitCode = 1;
      return;
    }

    const resolvedPrompt: LegacyPrompt = found.resolvedPrompt;

    const vars = parseSet(opts.set);
    const rendered = renderRuntimePrompt({
      prompt: resolvedPrompt,
      vars,
      target: opts.target === "generic" ? "generic" : "openai",
    });
    if (rendered.issues.length) {
      for (const issue of rendered.issues) {
        console.error(`❌ ${issue}`);
      }
      if (rendered.issues.some((issue) => issue.startsWith("Unknown inputs provided:")) && resolvedPrompt) {
        console.error(`Allowed inputs: ${Object.keys(resolvedPrompt.inputs ?? {}).join(", ") || "(none)"}`);
      }
      if (rendered.issues.some((issue) => issue.startsWith("Missing required inputs:"))) {
        console.error(`Provide them via --set key=value`);
      }
      process.exitCode = 1;
      return;
    }

    process.stdout.write(rendered.output ?? "");
  });

  return c;
}
