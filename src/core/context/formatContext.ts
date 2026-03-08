import path from "node:path";

export type ContextMode = "path" | "git-diff" | "prompt-aware";

export type ContextBundle = {
  mode: ContextMode;
  requestedTarget: string;
  files: string[];
  notes: string[];
};

function toPosix(p: string): string {
  return p.replaceAll("\\", "/");
}

function relPath(cwdAbs: string, absPath: string): string {
  const rel = path.relative(cwdAbs, absPath);
  return toPosix(rel || ".");
}

function hasReactComponentLikeFile(relFiles: string[]): boolean {
  for (const rel of relFiles) {
    if (!/\.(tsx|jsx)$/i.test(rel)) continue;
    const base = path.basename(rel, path.extname(rel));
    if (/^[A-Z]/.test(base) || rel.includes("/components/")) {
      return true;
    }
  }
  return false;
}

function containsApiHandler(relFiles: string[]): boolean {
  return relFiles.some(
    (rel) =>
      rel.includes("/app/api/") ||
      rel.includes("/pages/api/") ||
      /(^|\/)api\//.test(rel) ||
      /(^|\/)route\.(ts|tsx|js|jsx)$/i.test(rel),
  );
}

export function deriveContextNotes(
  filesAbs: string[],
  cwdAbs: string,
  opts?: { testsDirName?: string },
): string[] {
  const relFiles = filesAbs
    .map((abs) => relPath(cwdAbs, abs))
    .sort((a, b) => a.localeCompare(b));

  const notes: string[] = [];

  const testsDirName = (opts?.testsDirName ?? "__tests__").trim();
  const hasTests = relFiles.some(
    (rel) =>
      /(^|\/)(__tests__|tests)\//.test(rel) ||
      /\.(test|spec)\.(ts|tsx|js|jsx)$/i.test(rel) ||
      (testsDirName.length > 0 && rel.includes(`/${testsDirName}/`)),
  );
  if (hasTests) notes.push("Contains tests.");

  if (containsApiHandler(relFiles)) {
    notes.push("Contains API handlers.");
  }

  if (hasReactComponentLikeFile(relFiles)) {
    notes.push("Contains React components.");
  }

  const hasHooks = relFiles.some(
    (rel) => rel.includes("/hooks/") || /(^|\/)use[A-Z][^/]*\.(ts|tsx|js|jsx)$/i.test(rel),
  );
  if (hasHooks) notes.push("Contains hooks.");

  const hasUtilities = relFiles.some((rel) => rel.includes("/utils/") || rel.includes("/lib/"));
  if (hasUtilities) notes.push("Contains shared utility modules.");

  const routeFiles = relFiles.filter((rel) => /(^|\/)(route|page|layout)\.(ts|tsx|js|jsx)$/i.test(rel));
  if (routeFiles.length > 1) {
    notes.push(`Multiple route files detected (${routeFiles.length}).`);
  }

  if (!notes.length) {
    notes.push("No obvious framework-specific hotspots detected.");
  }

  return notes;
}

export function formatContextMarkdown(bundle: ContextBundle, cwdAbs: string): string {
  const relFiles = bundle.files
    .map((abs) => relPath(cwdAbs, abs))
    .sort((a, b) => a.localeCompare(b));

  const lines: string[] = [];
  lines.push("# PromptFarm Context Bundle");
  lines.push("");
  lines.push("## Mode");
  lines.push(bundle.mode);
  lines.push("");
  lines.push("## Requested target");
  lines.push(bundle.requestedTarget);
  lines.push("");
  lines.push("## Relevant files");

  if (!relFiles.length) {
    lines.push("(none)");
  } else {
    for (const rel of relFiles) {
      lines.push(`- ${rel}`);
    }
  }

  lines.push("");
  lines.push("## Notes");

  if (!bundle.notes.length) {
    lines.push("- (none)");
  } else {
    for (const note of bundle.notes) {
      lines.push(`- ${note}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
