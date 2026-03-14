export type RuntimeReportIssueSeverity = "error" | "warning";

export type RuntimeReportIssue = {
  severity: RuntimeReportIssueSeverity;
  message: string;
  filepath?: string;
  promptId?: string;
};

export type RuntimeReportSummary = {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  warnings: number;
  errors: number;
};

export type RuntimeCommandReport<TItem> = {
  command: string;
  cwd: string;
  generatedAt: string;
  items: TItem[];
  summary: RuntimeReportSummary;
  issues: RuntimeReportIssue[];
};

export function makeRuntimeCommandReport<TItem>(opts: {
  command: string;
  cwd: string;
  items: TItem[];
  total?: number;
  failed?: number;
  skipped?: number;
  issues?: RuntimeReportIssue[];
}): RuntimeCommandReport<TItem> {
  const issues = opts.issues ?? [];
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const total = opts.total ?? opts.items.length;
  const failed = opts.failed ?? errors;
  const skipped = opts.skipped ?? 0;
  const succeeded = Math.max(0, total - failed - skipped);

  return {
    command: opts.command,
    cwd: opts.cwd,
    generatedAt: new Date().toISOString(),
    items: opts.items,
    summary: {
      total,
      succeeded,
      failed,
      skipped,
      warnings,
      errors,
    },
    issues,
  };
}

