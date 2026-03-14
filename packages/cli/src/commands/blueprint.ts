import { Command } from "commander";
import path from "node:path";
import type { ArtifactBlueprint } from "@promptfarm/core";
import { loadConfig } from "@promptfarm/core/node";
import { loadPromptFiles } from "@promptfarm/core/node";
import { makeRuntimeCommandReport } from "@promptfarm/core";
import { type ExecutionContext, resolveAllRuntimeFromFiles } from "@promptfarm/core";
import { createBlueprintExecutionBundle } from "@promptfarm/core";
import { printDebug } from "../terminal/debug.js";

type OutputFormat = "text" | "json";

type BlueprintOutput = {
  promptId: string;
  artifactType: ArtifactBlueprint["artifactType"];
  sourceFilepath: string;
  evaluation?: {
    verdict: "pass" | "fail";
    normalizedScore: number;
  };
  blueprint: ArtifactBlueprint;
};

function toOutput(context: ExecutionContext): BlueprintOutput {
  if (!context.blueprint) {
    throw new Error(`Blueprint missing for ${context.promptId}.`);
  }

  const base: BlueprintOutput = {
    promptId: context.promptId,
    artifactType: context.blueprint.artifactType,
    sourceFilepath: context.sourceFilepath,
    blueprint: context.blueprint,
  };

  if (context.evaluation) {
    base.evaluation = {
      verdict: context.evaluation.aggregated.verdict,
      normalizedScore: context.evaluation.aggregated.normalizedScore,
    };
  }

  return base;
}

export function cmdBlueprint(): Command {
  const c = new Command("blueprint")
    .description("Generate deterministic artifact blueprints from resolved prompts")
    .argument("[id]", "Prompt id (omit to generate blueprints for all prompts)")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--format <format>", "Output format: text|json", "text")
    .option("--debug", "Print resolved config/paths");

  c.action(async (id: string | undefined, opts) => {
    const cwd = path.resolve(opts.cwd);
    const cfg = await loadConfig(cwd);
    const files = await loadPromptFiles({ patternAbs: cfg.promptGlobAbs });
    if (opts.debug) printDebug(cfg, { command: "blueprint", matchedFiles: files.length });

    const runtime = resolveAllRuntimeFromFiles(files, cwd);
    if (runtime.issues.length) {
      const report = makeRuntimeCommandReport<BlueprintOutput>({
        command: "blueprint",
        cwd,
        items: [],
        total: 0,
        failed: runtime.issues.length,
        issues: runtime.issues.map((issue) => ({
          severity: "error" as const,
          filepath: issue.filepath,
          message: issue.message,
        })),
      });

      if (opts.format === "json") {
        process.stdout.write(`${JSON.stringify({ ...report, reports: report.items }, null, 2)}\n`);
      } else {
        console.error(`❌ Blueprint generation blocked by runtime errors (${runtime.issues.length} issues):`);
        for (const issue of runtime.issues) {
          console.error(`- ${issue.filepath}: ${issue.message}`);
        }
      }
      process.exitCode = 1;
      return;
    }

    const selected = id ? runtime.contexts.filter((context) => context.promptId === id) : runtime.contexts;
    if (id && selected.length === 0) {
      console.error(`❌ Prompt not found: ${id}`);
      console.error(`Available: ${runtime.contexts.map((context) => context.promptId).join(", ")}`);
      process.exitCode = 1;
      return;
    }

    const generated = createBlueprintExecutionBundle(selected, { evaluateIfConfigured: true });
    const outputs = generated.contexts.map(toOutput);
    const commandReport = makeRuntimeCommandReport<BlueprintOutput>({
      command: "blueprint",
      cwd,
      items: outputs,
      total: selected.length,
      failed: generated.issues.length,
      issues: generated.issues.map((issue) => ({
        severity: "error" as const,
        filepath: issue.filepath,
        message: issue.message,
      })),
    });
    const format: OutputFormat = opts.format === "json" ? "json" : "text";

    if (format === "json") {
      process.stdout.write(
        `${JSON.stringify(
          {
            ...commandReport,
            reports: commandReport.items,
            summary: {
              ...commandReport.summary,
              withEvaluation: outputs.filter((item) => item.evaluation).length,
            },
            issues: commandReport.issues,
          },
          null,
          2,
        )}\n`,
      );
    } else {
      for (const output of outputs) {
        const evalPart = output.evaluation
          ? `; evaluation=${output.evaluation.verdict} (${output.evaluation.normalizedScore})`
          : "";
        console.log(
          `${output.promptId} [${output.artifactType}] -> blueprint v${output.blueprint.version}${evalPart}`,
        );
      }
      if (generated.issues.length) {
        console.log("Errors:");
        for (const issue of generated.issues) {
          console.log(`- ${issue.filepath}: ${issue.message}`);
        }
      }
      console.log(`Generated: ${commandReport.summary.succeeded}`);
    }

    if (generated.issues.length > 0 || outputs.length === 0) {
      process.exitCode = 1;
    }
  });

  return c;
}
