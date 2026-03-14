import { Command } from "commander";
import path from "node:path";
import { loadConfig } from "@promptfarm/core/node";
import { loadPromptFiles } from "@promptfarm/core/node";
import { evaluateExecutionContext } from "@promptfarm/core";
import { formatEvaluationReportText } from "@promptfarm/core";
import { makeRuntimeCommandReport, type RuntimeReportIssue } from "@promptfarm/core";
import type { PromptEvaluationReport } from "@promptfarm/core";
import { type ExecutionContext, resolveAllRuntimeFromFiles } from "@promptfarm/core";
import { printDebug } from "../terminal/debug.js";

type OutputFormat = "text" | "json";

export function cmdEvaluate(): Command {
  const c = new Command("evaluate")
    .description("Evaluate prompt quality using deterministic reviewer scoring")
    .argument("[id]", "Prompt id (omit to evaluate all prompts with evaluation spec)")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--format <format>", "Output format: text|json", "text")
    .option("--debug", "Print resolved config/paths");

  c.action(async (id: string | undefined, opts) => {
    const cwd = path.resolve(opts.cwd);
    const cfg = await loadConfig(cwd);
    const files = await loadPromptFiles({ patternAbs: cfg.promptGlobAbs });
    if (opts.debug) printDebug(cfg, { command: "evaluate", matchedFiles: files.length });

    const runtime = resolveAllRuntimeFromFiles(files, cwd);
    if (runtime.issues.length) {
      const report = makeRuntimeCommandReport<PromptEvaluationReport>({
        command: "evaluate",
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
        console.error(`❌ Evaluation blocked by runtime errors (${runtime.issues.length} issues):`);
        for (const issue of runtime.issues) {
          console.error(`- ${issue.filepath}: ${issue.message}`);
        }
      }
      process.exitCode = 1;
      return;
    }

    const format: OutputFormat = opts.format === "json" ? "json" : "text";

    const selected = id ? runtime.contexts.filter((context) => context.promptId === id) : runtime.contexts;

    if (id && selected.length === 0) {
      console.error(`❌ Prompt not found: ${id}`);
      console.error(`Available: ${runtime.contexts.map((context) => context.promptId).join(", ")}`);
      process.exitCode = 1;
      return;
    }

    const reports: PromptEvaluationReport[] = [];
    const evaluatedContexts: ExecutionContext[] = [];
    const skipped: string[] = [];
    const issues: Array<{ promptId: string; message: string }> = [];

    for (const context of selected) {
      try {
        const report = evaluateExecutionContext(context);
        reports.push(report);
        evaluatedContexts.push({
          ...context,
          evaluation: report,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!id && message.includes("has no spec.evaluation configured")) {
          skipped.push(context.promptId);
          continue;
        }

        issues.push({ promptId: context.promptId, message });
      }
    }

    const failedReports = reports.filter((report) => report.aggregated.verdict === "fail");
    const reportIssues: RuntimeReportIssue[] = [
      ...issues.map((issue) => ({
        severity: "error" as const,
        promptId: issue.promptId,
        message: issue.message,
      })),
      ...failedReports.map((report) => ({
        severity: "warning" as const,
        promptId: report.promptId,
        message: `quality gate verdict is fail`,
      })),
    ];

    const commandReport = makeRuntimeCommandReport<PromptEvaluationReport>({
      command: "evaluate",
      cwd,
      items: reports,
      total: selected.length,
      failed: failedReports.length + issues.length,
      skipped: skipped.length,
      issues: reportIssues,
    });

    if (format === "json") {
      process.stdout.write(
        `${JSON.stringify(
          {
            ...commandReport,
            reports: commandReport.items,
            summary: {
              ...commandReport.summary,
              passed: commandReport.summary.succeeded,
              skippedPrompts: skipped,
            },
            contexts: evaluatedContexts,
            issues: commandReport.issues,
          },
          null,
          2,
        )}\n`,
      );
    } else {
      for (const report of reports) {
        console.log(formatEvaluationReportText(report));
        console.log("");
      }

      if (skipped.length) {
        console.log(`Skipped (no spec.evaluation): ${skipped.join(", ")}`);
      }
      if (issues.length) {
        console.log("Errors:");
        for (const issue of issues) {
          console.log(`- ${issue.promptId}: ${issue.message}`);
        }
      }

      console.log(`Evaluated: ${commandReport.summary.total - commandReport.summary.skipped}`);
      console.log(`Passed: ${commandReport.summary.succeeded}`);
      console.log(`Failed: ${commandReport.summary.failed}`);
    }

    if (issues.length > 0 || failedReports.length > 0 || reports.length === 0) {
      process.exitCode = 1;
    }
  });

  return c;
}
