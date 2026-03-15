import type { PromptEvaluationReport } from "./types.js";

export function formatEvaluationReportText(report: PromptEvaluationReport): string {
  const lines: string[] = [];

  lines.push(`Prompt: ${report.promptId}`);
  lines.push(`Run: ${report.run.runId}`);
  lines.push(`Overall: ${report.aggregated.overallScore}/${report.aggregated.overallMaxScore}`);
  lines.push(`Verdict: ${report.aggregated.verdict.toUpperCase()}`);
  lines.push("");

  lines.push("Reviewers:");
  for (const reviewer of report.reviewerResults) {
    lines.push(
      `- ${reviewer.reviewerId}: ${reviewer.overallScore}/${reviewer.overallMaxScore} (${reviewer.verdict.toUpperCase()})`,
    );
  }
  lines.push("");

  lines.push("Quality Gates:");
  if (report.aggregated.gateResults.length === 0) {
    lines.push("- (none)");
  } else {
    for (const gate of report.aggregated.gateResults) {
      lines.push(`- ${gate.passed ? "PASS" : "FAIL"}: ${gate.message}`);
    }
  }

  return lines.join("\n");
}
