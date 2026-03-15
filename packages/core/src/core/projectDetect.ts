import fg from "fast-glob";
import fs from "node:fs/promises";
import path from "node:path";

export type ProjectFramework = "nextjs" | "unknown";
export type ProjectLanguage = "typescript" | "javascript";

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

export type ProjectDetection = {
  framework: ProjectFramework;
  language: ProjectLanguage;
  evidence: string[];
};

async function exists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(cwdAbs: string): Promise<PackageJson | null> {
  const packageJsonPath = path.join(cwdAbs, "package.json");
  if (!(await exists(packageJsonPath))) return null;

  try {
    const txt = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(txt) as PackageJson;
    return parsed;
  } catch {
    return null;
  }
}

function hasDependency(pkg: PackageJson | null, name: string): boolean {
  if (!pkg) return false;
  return Boolean(
    pkg.dependencies?.[name] ??
      pkg.devDependencies?.[name] ??
      pkg.peerDependencies?.[name] ??
      pkg.optionalDependencies?.[name],
  );
}

export async function detectProject(cwdAbs: string): Promise<ProjectDetection> {
  const evidence: string[] = [];
  const packageJson = await readPackageJson(cwdAbs);

  const tsconfigPath = path.join(cwdAbs, "tsconfig.json");
  const hasTsconfig = await exists(tsconfigPath);
  if (hasTsconfig) evidence.push("tsconfig.json found");

  const nextConfigPatterns = [
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "next.config.cjs",
  ].map((p) => path.join(cwdAbs, p));
  const nextConfigChecks = await Promise.all(nextConfigPatterns.map((p) => exists(p)));
  const hasNextConfig = nextConfigChecks.some(Boolean);
  if (hasNextConfig) evidence.push("next.config.* found");

  const hasNextDep = hasDependency(packageJson, "next");
  if (hasNextDep) evidence.push('package.json contains dependency "next"');

  const hasTypeScriptDep = hasDependency(packageJson, "typescript");
  if (hasTypeScriptDep) evidence.push('package.json contains dependency "typescript"');

  const projectPaths = ["src", "app", "pages", "components", "lib", "api"];
  for (const rel of projectPaths) {
    if (await exists(path.join(cwdAbs, rel))) {
      evidence.push(`${rel}/ exists`);
    }
  }

  const docsPaths = ["README.md", "README", "docs"];
  for (const rel of docsPaths) {
    if (await exists(path.join(cwdAbs, rel))) {
      evidence.push(`${rel} found`);
    }
  }

  const tsMatches = await fg(
    [
      "src/**/*.{ts,tsx,mts,cts}",
      "app/**/*.{ts,tsx,mts,cts}",
      "pages/**/*.{ts,tsx,mts,cts}",
      "components/**/*.{ts,tsx,mts,cts}",
      "lib/**/*.{ts,tsx,mts,cts}",
      "api/**/*.{ts,tsx,mts,cts}",
    ],
    {
      cwd: cwdAbs,
      absolute: false,
      onlyFiles: true,
      suppressErrors: true,
      unique: true,
    },
  );

  const hasTsSources = tsMatches.length > 0;
  if (hasTsSources) evidence.push("TypeScript source files found");

  const framework: ProjectFramework = hasNextDep || hasNextConfig ? "nextjs" : "unknown";
  const language: ProjectLanguage =
    hasTsconfig || hasTypeScriptDep || hasTsSources ? "typescript" : "javascript";

  return { framework, language, evidence };
}
