import { Command } from "commander";
import path from "node:path";
import { runDoctorChecks } from "../../core/doctorChecks.js";

function marker(status: "success" | "warning" | "error"): string {
  if (status === "success") return "✓";
  if (status === "warning") return "⚠";
  return "✗";
}

export function cmdDoctor(): Command {
  const c = new Command("doctor")
    .description("Check project health and diagnostics")
    .option("--cwd <path>", "Project root", process.cwd());

  c.action(async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const report = await runDoctorChecks(cwd);

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
