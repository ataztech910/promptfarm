import { Command } from "commander";
import path from "node:path";
import { runDoctorChecks } from "@promptfarm/core/node";
import { makeRuntimeCommandReport } from "@promptfarm/core";

type OutputFormat = "text" | "json";

function marker(status: "success" | "warning" | "error"): string {
  if (status === "success") return "✓";
  if (status === "warning") return "⚠";
  return "✗";
}

export function cmdDoctor(): Command {
  const c = new Command("doctor")
    .description("Check project health and diagnostics")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--format <format>", "Output format: text|json", "text");

  c.action(async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const format: OutputFormat = opts.format === "json" ? "json" : "text";
    const report = await runDoctorChecks(cwd);
    const runtimeReport = makeRuntimeCommandReport({
      command: "doctor",
      cwd,
      items: report.checks,
      total: report.checks.length,
      failed: report.checks.filter((check) => check.status === "error").length,
      issues: report.checks
        .filter((check) => check.status !== "success")
        .map((check) => ({
          severity: check.status === "error" ? "error" : "warning",
          message: check.message,
        })),
    });

    if (format === "json") {
      process.stdout.write(`${JSON.stringify({ ...runtimeReport, reports: runtimeReport.items }, null, 2)}\n`);
      if (report.hasErrors) {
        process.exitCode = 1;
      }
      return;
    }

    for (const check of report.checks) {
      console.log(`${marker(check.status)} ${check.message}`);
      if (check.details?.length) {
        for (const line of check.details) {
          console.log(line);
        }
      }
    }

    console.log("");
    if (report.hasErrors) {
      console.log("Doctor found issues.");
      process.exitCode = 1;
      return;
    }

    if (report.hasWarnings) {
      console.log("Doctor completed with warnings.");
      return;
    }

    console.log("All checks passed.");
  });

  return c;
}
