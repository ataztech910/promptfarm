import { Command } from "commander";
import path from "node:path";
import type { ExecutionContext } from "@promptfarm/core";
import { loadConfig } from "@promptfarm/core/node";
import { loadPromptFiles } from "@promptfarm/core/node";
import { makeRuntimeCommandReport, type RuntimeReportIssue } from "@promptfarm/core";
import { resolveAllRuntimeFromFiles } from "@promptfarm/core";
import { printDebug } from "../terminal/debug.js";

type OutputFormat = "text" | "json";

type ResolveReportItem = {
  promptId: string;
  sourceFilepath: string;
  artifactType: ExecutionContext["resolvedArtifact"]["artifactType"];
  dependencyOrder: string[];
  inputsCount: number;
  messagesCount: number;
  resolvedArtifact: ExecutionContext["resolvedArtifact"];
};

function toResolveItem(context: ExecutionContext): ResolveReportItem {
  return {
    promptId: context.promptId,
    sourceFilepath: context.sourceFilepath,
    artifactType: context.resolvedArtifact.artifactType,
    dependencyOrder: context.resolvedArtifact.dependencyOrder,
    inputsCount: context.resolvedArtifact.inputs.length,
    messagesCount: context.resolvedArtifact.messages.length,
    resolvedArtifact: context.resolvedArtifact,
  };
}

function toRuntimeIssues(issues: Array<{ filepath: string; message: string }>): RuntimeReportIssue[] {
  return issues.map((issue) => ({
    severity: "error" as const,
    filepath: issue.filepath,
    message: issue.message,
  }));
}

export function cmdResolve(): Command {
  const c = new Command("resolve")
    .description("Resolve prompt dependencies and output runtime artifacts")
    .argument("[id]", "Prompt id (omit to resolve all prompts)")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--format <format>", "Output format: text|json", "text")
    .option("--debug", "Print resolved config/paths");

  c.action(async (id: string | undefined, opts) => {
    const cwd = path.resolve(opts.cwd);
    const cfg = await loadConfig(cwd);
    const files = await loadPromptFiles({ patternAbs: cfg.promptGlobAbs });
    if (opts.debug) printDebug(cfg, { command: "resolve", matchedFiles: files.length });

    const runtime = resolveAllRuntimeFromFiles(files, cwd);
    const format: OutputFormat = opts.format === "json" ? "json" : "text";
    const runtimeIssues = toRuntimeIssues(runtime.issues);

    if (runtime.issues.length) {
      const report = makeRuntimeCommandReport<ResolveReportItem>({
        command: "resolve",
        cwd,
        items: [],
        total: 0,
        failed: runtime.issues.length,
        issues: runtimeIssues,
      });

      if (format === "json") {
        process.stdout.write(`${JSON.stringify({ ...report, reports: report.items }, null, 2)}\n`);
      } else {
        console.error(`❌ Resolve failed (${runtime.issues.length} issues):`);
        for (const issue of runtime.issues) {
          console.error(`- ${issue.filepath}: ${issue.message}`);
        }
      }

      process.exitCode = 1;
      return;
    }

    const selected = id ? runtime.contexts.filter((context) => context.promptId === id) : runtime.contexts;
    if (id && selected.length === 0) {
      const issues: RuntimeReportIssue[] = [
        {
          severity: "error",
          promptId: id,
          message: `Prompt not found: ${id}`,
        },
      ];

      const report = makeRuntimeCommandReport<ResolveReportItem>({
        command: "resolve",
        cwd,
        items: [],
        total: runtime.contexts.length,
        failed: 1,
        issues,
      });

      if (format === "json") {
        process.stdout.write(`${JSON.stringify({ ...report, reports: report.items }, null, 2)}\n`);
      } else {
        console.error(`❌ Prompt not found: ${id}`);
        console.error(`Available: ${runtime.contexts.map((context) => context.promptId).join(", ")}`);
      }
      process.exitCode = 1;
      return;
    }

    const items = selected.map(toResolveItem);
    const report = makeRuntimeCommandReport<ResolveReportItem>({
      command: "resolve",
      cwd,
      items,
      total: items.length,
    });

    if (format === "json") {
      process.stdout.write(`${JSON.stringify({ ...report, reports: report.items }, null, 2)}\n`);
      return;
    }

    for (const item of items) {
      console.log(`${item.promptId} [${item.artifactType}]`);
      console.log(`  source: ${path.relative(cwd, item.sourceFilepath)}`);
      console.log(`  dependencyOrder: ${item.dependencyOrder.join(" -> ")}`);
      console.log(`  inputs: ${item.inputsCount}; messages: ${item.messagesCount}`);
    }
    console.log(`Resolved: ${items.length}`);
  });

  return c;
}
