import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

const BASE_IGNORED_DIRS = ["node_modules", ".next", "dist", "build", ".git", "coverage"];

function normalizeAbs(p: string): string {
  return path.normalize(p);
}

function toPosix(p: string): string {
  return p.replaceAll("\\", "/");
}

function uniqueSorted(items: string[]): string[] {
  return Array.from(new Set(items.map((x) => normalizeAbs(x)))).sort((a, b) => a.localeCompare(b));
}

function buildIgnoredDirSet(extraDirNames?: string[]): Set<string> {
  const out = new Set<string>(BASE_IGNORED_DIRS);
  for (const item of extraDirNames ?? []) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const base = path.basename(trimmed.replaceAll("\\", "/"));
    if (base) out.add(base);
  }
  return out;
}

function buildIgnoreGlobs(ignoredDirNames: Set<string>): string[] {
  const out: string[] = [];
  for (const dir of ignoredDirNames) {
    out.push(`**/${dir}/**`);
  }
  return out;
}

export function isIgnoredPath(absPath: string, extraDirNames?: string[]): boolean {
  const ignoredDirNames = buildIgnoredDirSet(extraDirNames);
  const parts = toPosix(path.resolve(absPath)).split("/");
  return parts.some((part) => ignoredDirNames.has(part));
}

export async function resolveExistingPath(cwdAbs: string, candidate: string): Promise<string | undefined> {
  const abs = path.resolve(cwdAbs, candidate);
  try {
    await fs.access(abs);
    return normalizeAbs(abs);
  } catch {
    return undefined;
  }
}

async function collectFilesInDir(dirAbs: string, cap: number, extraDirNames?: string[]): Promise<string[]> {
  const ignoredDirNames = buildIgnoredDirSet(extraDirNames);
  const files = await fg("**/*", {
    cwd: dirAbs,
    absolute: true,
    onlyFiles: true,
    dot: false,
    ignore: buildIgnoreGlobs(ignoredDirNames),
  });
  return uniqueSorted(files).slice(0, cap);
}

async function collectSiblingFiles(fileAbs: string, cap: number, extraDirNames?: string[]): Promise<string[]> {
  const dirAbs = path.dirname(fileAbs);
  const ignoredDirNames = buildIgnoredDirSet(extraDirNames);
  const files = await fg("*", {
    cwd: dirAbs,
    absolute: true,
    onlyFiles: true,
    dot: false,
    ignore: buildIgnoreGlobs(ignoredDirNames),
  });

  const normalizedTarget = normalizeAbs(fileAbs);
  const filtered = files
    .map((f) => normalizeAbs(f))
    .filter((f) => f !== normalizedTarget)
    .sort((a, b) => a.localeCompare(b));

  return filtered.slice(0, cap);
}

async function collectParentNearbyFiles(dirAbs: string, cap: number, extraDirNames?: string[]): Promise<string[]> {
  const parentAbs = path.dirname(dirAbs);
  if (parentAbs === dirAbs) return [];

  const ignoredDirNames = buildIgnoredDirSet(extraDirNames);
  const files = await fg("*", {
    cwd: parentAbs,
    absolute: true,
    onlyFiles: true,
    dot: false,
    ignore: buildIgnoreGlobs(ignoredDirNames),
  });

  return uniqueSorted(files).slice(0, cap);
}

export type PathContextResult = {
  targetAbs: string;
  targetKind: "file" | "directory";
  files: string[];
  notes: string[];
};

export async function collectFilesForPathMode(
  cwdAbs: string,
  targetPath: string,
  opts?: {
    dirFileCap?: number;
    siblingCap?: number;
    nearbyCap?: number;
    extraIgnoredDirNames?: string[];
  },
): Promise<PathContextResult> {
  const dirFileCap = Math.max(1, opts?.dirFileCap ?? 60);
  const siblingCap = Math.max(0, opts?.siblingCap ?? 8);
  const nearbyCap = Math.max(0, opts?.nearbyCap ?? 6);
  const extraIgnoredDirNames = opts?.extraIgnoredDirNames;

  const targetAbs = path.resolve(cwdAbs, targetPath);

  let stat;
  try {
    stat = await fs.stat(targetAbs);
  } catch {
    throw new Error(`Path not found: ${targetPath}`);
  }

  if (stat.isFile()) {
    const siblings = await collectSiblingFiles(targetAbs, siblingCap, extraIgnoredDirNames);
    const files = uniqueSorted([targetAbs, ...siblings]);

    return {
      targetAbs: normalizeAbs(targetAbs),
      targetKind: "file",
      files,
      notes: [`Target is a file; included ${Math.min(siblingCap, siblings.length)} sibling file(s).`],
    };
  }

  if (stat.isDirectory()) {
    const recursive = await collectFilesInDir(targetAbs, dirFileCap, extraIgnoredDirNames);
    const nearby = await collectParentNearbyFiles(targetAbs, nearbyCap, extraIgnoredDirNames);
    const files = uniqueSorted([...recursive, ...nearby]);

    if (!files.length) {
      throw new Error(`No files found under path: ${targetPath}`);
    }

    const notes: string[] = [
      `Target is a directory; included ${recursive.length} file(s) recursively.`,
    ];

    if (recursive.length >= dirFileCap) {
      notes.push(`Recursive file list capped at ${dirFileCap} files.`);
    }

    if (nearby.length > 0) {
      notes.push(`Included ${nearby.length} nearby file(s) from parent directory.`);
    }

    return {
      targetAbs: normalizeAbs(targetAbs),
      targetKind: "directory",
      files,
      notes,
    };
  }

  throw new Error(`Unsupported path type: ${targetPath}`);
}

export async function expandWithNearbyFiles(
  seedFiles: string[],
  opts?: {
    extraCap?: number;
    perDirCap?: number;
    extraIgnoredDirNames?: string[];
  },
): Promise<string[]> {
  const perDirCap = Math.max(1, opts?.perDirCap ?? 3);
  const extraCap = Math.max(0, opts?.extraCap ?? 20);
  const extraIgnoredDirNames = opts?.extraIgnoredDirNames;

  const out = new Set<string>(seedFiles.map((x) => normalizeAbs(x)));
  if (extraCap === 0 || seedFiles.length === 0) {
    return Array.from(out).sort((a, b) => a.localeCompare(b));
  }

  const dirs = Array.from(
    new Set(
      seedFiles
        .map((f) => normalizeAbs(path.dirname(f)))
        .sort((a, b) => a.localeCompare(b)),
    ),
  );

  let added = 0;
  const ignoredDirNames = buildIgnoredDirSet(extraIgnoredDirNames);

  for (const dirAbs of dirs) {
    if (added >= extraCap) break;

    const siblings = await fg("*", {
      cwd: dirAbs,
      absolute: true,
      onlyFiles: true,
      dot: false,
      ignore: buildIgnoreGlobs(ignoredDirNames),
    });

    let localAdded = 0;
    for (const raw of siblings.sort((a, b) => a.localeCompare(b))) {
      if (added >= extraCap || localAdded >= perDirCap) break;
      const item = normalizeAbs(raw);
      if (out.has(item)) continue;
      out.add(item);
      added += 1;
      localAdded += 1;
    }
  }

  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

function componentScore(absPath: string, componentLower: string): number {
  const posix = toPosix(absPath).toLowerCase();
  const base = path.basename(absPath, path.extname(absPath)).toLowerCase();

  let score = 0;
  if (base === componentLower) score += 100;
  if (base === `${componentLower}.test` || base === `${componentLower}.spec`) score += 95;
  if (base.startsWith(componentLower)) score += 75;
  if (base.includes(componentLower)) score += 60;
  if (posix.includes(`/${componentLower}/`)) score += 20;
  if (posix.includes("/components/")) score += 10;

  return score;
}

export async function findFilesByComponentName(
  cwdAbs: string,
  componentName: string,
  opts?: {
    maxMatches?: number;
    extraIgnoredDirNames?: string[];
  },
): Promise<string[]> {
  const component = componentName.trim();
  if (!component) return [];

  const maxMatches = Math.max(1, opts?.maxMatches ?? 12);
  const ignoredDirNames = buildIgnoredDirSet(opts?.extraIgnoredDirNames);

  const candidates = await fg("**/*.{ts,tsx,js,jsx}", {
    cwd: cwdAbs,
    absolute: true,
    onlyFiles: true,
    dot: false,
    ignore: buildIgnoreGlobs(ignoredDirNames),
  });

  const needle = component.toLowerCase();

  const scored = candidates
    .map((absPath) => ({ absPath: normalizeAbs(absPath), score: componentScore(absPath, needle) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.absPath.localeCompare(b.absPath))
    .slice(0, maxMatches)
    .map((item) => item.absPath);

  return uniqueSorted(scored);
}

export async function filterExistingFiles(files: string[], extraDirNames?: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const fileAbs of files) {
    try {
      const stat = await fs.stat(fileAbs);
      if (!stat.isFile()) continue;
      if (isIgnoredPath(fileAbs, extraDirNames)) continue;
      out.push(normalizeAbs(fileAbs));
    } catch {
      // ignore missing paths
    }
  }
  return uniqueSorted(out);
}
