import { Command } from "commander";
import path from "node:path";
import { loadConfig } from "@promptfarm/core/node";
import { loadPromptFiles } from "@promptfarm/core/node";
import { checkInputs } from "@promptfarm/core";
import { makeRuntimeCommandReport } from "@promptfarm/core";
import { resolveAllRuntimeFromFiles } from "@promptfarm/core";
import { writeResolvedPromptArtifacts } from "@promptfarm/core/node";
import { printDebug } from "../terminal/debug.js";

type OutputFormat = "text" | "json";

type BuildReportItem = {
  promptId: string;
  artifactType: string;
  builtFiles: string[];
};

export function cmdBuild(): Command {
  const c = new Command("build")
    .description("Build dist artifacts from prompts")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--out <dir>", "Override output directory (defaults to config distDir)")
    .option("--format <format>", "Output format: text|json", "text")
    .option("--debug", "Print resolved config/paths");

  c.action(async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const cfg = await loadConfig(cwd);
    const outDir = opts.out ? path.resolve(cwd, opts.out) : cfg.distDirAbs;
    const format: OutputFormat = opts.format === "json" ? "json" : "text";

    const files = await loadPromptFiles({ patternAbs: cfg.promptGlobAbs });
    if (opts.debug) printDebug(cfg, { command: "build", matchedFiles: files.length });
    const runtime = resolveAllRuntimeFromFiles(files, cwd);

    if (runtime.issues.length) {
      const report = makeRuntimeCommandReport<BuildReportItem>({
        command: "build",
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

      if (format === "json") {
        process.stdout.write(`${JSON.stringify({ ...report, reports: report.items }, null, 2)}\n`);
      } else {
        console.error(`❌ Build blocked by runtime errors (${runtime.issues.length} issues):`);
        for (const issue of runtime.issues) console.error(`- ${issue.filepath}: ${issue.message}`);
      }
      process.exitCode = 1;
      return;
    }

    const resolvedValidationIssues: Array<{ filepath: string; message: string }> = [];
    for (const context of runtime.contexts) {
      const checks = checkInputs(context.resolvedPrompt, {});
      if (checks.usedButNotDeclared.length) {
        resolvedValidationIssues.push({
          filepath: context.sourceFilepath,
          message: `Template variables used but not declared in resolved inputs: ${checks.usedButNotDeclared.join(", ")}`,
        });
      }
    }
    if (resolvedValidationIssues.length) {
      const report = makeRuntimeCommandReport<BuildReportItem>({
        command: "build",
        cwd,
        items: [],
        total: runtime.contexts.length,
        failed: resolvedValidationIssues.length,
        issues: resolvedValidationIssues.map((issue) => ({
          severity: "error" as const,
          filepath: issue.filepath,
          message: issue.message,
        })),
      });

      if (format === "json") {
        process.stdout.write(`${JSON.stringify({ ...report, reports: report.items }, null, 2)}\n`);
      } else {
        console.error(`❌ Build blocked by resolved prompt validation errors (${resolvedValidationIssues.length} issues):`);
        for (const issue of resolvedValidationIssues) console.error(`- ${issue.filepath}: ${issue.message}`);
      }
      process.exitCode = 1;
      return;
    }

    const result = await writeResolvedPromptArtifacts({
      cwd,
      outDir,
      contexts: runtime.contexts,
    });
    if (result.issues.length) {
      const report = makeRuntimeCommandReport<BuildReportItem>({
        command: "build",
        cwd,
        items: result.artifacts.map((artifact) => ({
          promptId: artifact.promptId,
          artifactType: artifact.artifactType,
          builtFiles: artifact.builtFiles,
        })),
        total: runtime.contexts.length,
        failed: result.issues.length,
        issues: result.issues.map((issue) => ({
          severity: "error" as const,
          filepath: issue.filepath,
          message: issue.message,
        })),
      });

      if (format === "json") {
        process.stdout.write(`${JSON.stringify({ ...report, reports: report.items }, null, 2)}\n`);
      } else {
        console.error(`❌ Build blocked by builder errors (${result.issues.length} issues):`);
        for (const issue of result.issues) console.error(`- ${issue.filepath}: ${issue.message}`);
      }
      process.exitCode = 1;
      return;
    }

    const report = makeRuntimeCommandReport<BuildReportItem>({
      command: "build",
      cwd,
      items: result.artifacts.map((artifact) => ({
        promptId: artifact.promptId,
        artifactType: artifact.artifactType,
        builtFiles: artifact.builtFiles,
      })),
      total: runtime.contexts.length,
    });

    if (format === "json") {
      process.stdout.write(
        `${JSON.stringify(
          {
            ...report,
            reports: report.items,
            outputDir: path.relative(cwd, outDir),
            builtFiles: result.builtFiles,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    console.log(`✅ Built ${result.count} prompts (${result.builtFiles} built files) → ${path.relative(cwd, outDir)}/`);
  });

  return c;
}
