import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { filterExistingFiles } from "./findFiles.js";

const execFileAsync = promisify(execFile);

type ExecError = NodeJS.ErrnoException & {
  stderr?: string;
  stdout?: string;
};

async function runGit(cwdAbs: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: cwdAbs,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const e = err as ExecError;
    if (e.code === "ENOENT") {
      throw new Error("Git is not available on PATH.");
    }

    const stderr = `${e.stderr ?? ""}`.toLowerCase();
    if (stderr.includes("not a git repository")) {
      throw new Error("Current directory is not a git repository.");
    }

    throw new Error(`Failed to run git ${args.join(" ")}: ${e.message}`);
  }
}

function parseNameOnlyList(stdout: string): string[] {
  return stdout
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export type GitDiffContextResult = {
  changedFiles: string[];
  notes: string[];
};

export async function collectFilesFromGitDiff(
  cwdAbs: string,
  opts?: { extraIgnoredDirNames?: string[]; includeUntracked?: boolean },
): Promise<GitDiffContextResult> {
  await runGit(cwdAbs, ["rev-parse", "--is-inside-work-tree"]);

  const unstagedOut = await runGit(cwdAbs, ["diff", "--name-only", "--diff-filter=ACMR"]);
  const stagedOut = await runGit(cwdAbs, ["diff", "--name-only", "--cached", "--diff-filter=ACMR"]);
  const includeUntracked = Boolean(opts?.includeUntracked);
  const untrackedOut = includeUntracked
    ? await runGit(cwdAbs, ["ls-files", "--others", "--exclude-standard"])
    : "";

  const trackedRel = Array.from(
    new Set([...parseNameOnlyList(unstagedOut), ...parseNameOnlyList(stagedOut)]),
  ).sort((a, b) => a.localeCompare(b));
  const untrackedRel = parseNameOnlyList(untrackedOut).sort((a, b) => a.localeCompare(b));

  const trackedAbsCandidates = trackedRel.map((rel) => path.resolve(cwdAbs, rel));
  const untrackedAbsCandidates = untrackedRel.map((rel) => path.resolve(cwdAbs, rel));

  const trackedFiles = await filterExistingFiles(trackedAbsCandidates, opts?.extraIgnoredDirNames);
  const untrackedFiles = includeUntracked
    ? await filterExistingFiles(untrackedAbsCandidates, opts?.extraIgnoredDirNames)
    : [];

  const changedFiles = Array.from(new Set([...trackedFiles, ...untrackedFiles])).sort((a, b) =>
    a.localeCompare(b),
  );

  const notes: string[] = [];

  if (trackedFiles.length === 0 && (!includeUntracked || untrackedFiles.length === 0)) {
    notes.push("No changed files detected in git diff.");
  } else {
    notes.push(
      `Detected ${trackedFiles.length} tracked changed file(s) from local git diff (staged + unstaged).`,
    );
  }

  if (includeUntracked) {
    if (untrackedFiles.length > 0) {
      notes.push(`Included ${untrackedFiles.length} untracked file(s).`);
    } else {
      notes.push("No untracked files detected.");
    }
  }

  return { changedFiles, notes };
}
