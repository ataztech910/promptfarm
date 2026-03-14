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
  matchedFilepaths: string[];
  files: LoadedTestFile[];
  issues: TestLoadIssue[];
  ignoredFiles: string[];
};

export async function loadTestFiles(opts: {
  patternAbs: string;
  testsDirAbs?: string;
}): Promise<LoadedTestsResult> {
  if (!opts.patternAbs || typeof opts.patternAbs !== "string" || opts.patternAbs.trim().length === 0) {
    throw new Error(`loadTestFiles: patternAbs is empty. Got: "${String(opts.patternAbs)}"`);
  }

  const matchedFilepaths = (await fg(opts.patternAbs, { absolute: true, onlyFiles: true }))
    .map((filepath) => path.normalize(filepath))
    .sort((a, b) => a.localeCompare(b));
  const matchedSet = new Set(matchedFilepaths);

  let ignoredFiles: string[] = [];
  if (opts.testsDirAbs) {
    const testsDirGlob = `${path.resolve(opts.testsDirAbs).replaceAll("\\", "/")}/**/*`;
    const allFiles = (await fg(testsDirGlob, { absolute: true, onlyFiles: true }))
      .map((filepath) => path.normalize(filepath))
      .sort((a, b) => a.localeCompare(b));
    ignoredFiles = allFiles.filter((filepath) => !matchedSet.has(filepath));
  }

  const files: LoadedTestFile[] = [];
  const issues: TestLoadIssue[] = [];

  for (const filepath of matchedFilepaths) {
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

  return { matchedFilepaths, files, issues, ignoredFiles };
}
