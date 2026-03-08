import fg from "fast-glob";
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

export type LoadedTestFile = {
  filepath: string;
  raw: unknown;
};

export type TestLoadIssue = {
  filepath: string;
  message: string;
};

export type LoadedTestsResult = {
  files: LoadedTestFile[];
  issues: TestLoadIssue[];
};

export async function loadTestFiles(opts: {
  patternAbs: string;
}): Promise<LoadedTestsResult> {
  if (!opts.patternAbs || typeof opts.patternAbs !== "string" || opts.patternAbs.trim().length === 0) {
    throw new Error(`loadTestFiles: patternAbs is empty. Got: "${String(opts.patternAbs)}"`);
  }

  const matched = (await fg(opts.patternAbs, { absolute: true })).sort((a, b) => a.localeCompare(b));

  const files: LoadedTestFile[] = [];
  const issues: TestLoadIssue[] = [];

  for (const filepath of matched) {
    try {
      const txt = await fs.readFile(filepath, "utf8");
      const raw = YAML.parse(txt);
      files.push({ filepath: path.normalize(filepath), raw });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      issues.push({
        filepath: path.normalize(filepath),
        message,
      });
    }
  }

  return { files, issues };
}
