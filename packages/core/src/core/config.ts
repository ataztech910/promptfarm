import fs from "node:fs/promises";
import path from "node:path";

export type PromptFarmConfig = {
  paths?: {
    promptsDir?: string;
    testsDir?: string;
    distDir?: string;
  };
  globs?: {
    promptFiles?: string; // default: **/*.prompt.yaml
    testFiles?: string;   // default: **/*.test.yaml
  };
};

export type ResolvedConfig = {
  cwdAbs: string;
  configPath: string;
  configFound: boolean;
  promptsDir: string;
  testsDir: string;
  distDir: string;
  promptFiles: string;
  testFiles: string;
  promptsDirAbs: string;
  testsDirAbs: string;
  distDirAbs: string;
  promptGlobAbs: string; // absolute glob for fast-glob
  testGlobAbs: string;
};

type ConfigDefaults = {
  paths: {
    promptsDir: string;
    testsDir: string;
    distDir: string;
  };
  globs: {
    promptFiles: string;
    testFiles: string;
  };
};

const DEFAULTS: ConfigDefaults = {
  paths: {
    promptsDir: "prompts",
    testsDir: "__tests__",
    distDir: "dist",
  },
  globs: {
    promptFiles: "**/*.prompt.yaml",
    testFiles: "**/*.test.yaml",
  },
};

function assertNonEmpty(name: string, v: unknown): asserts v is string {
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new Error(`[promptfarm] config error: ${name} is empty (${String(v)})`);
  }
}

function normalizeString(name: string, value: unknown, fallback: string): string {
  const out = typeof value === "string" ? value.trim() : fallback;
  assertNonEmpty(name, out);
  return out;
}

export async function loadConfig(cwd: string): Promise<ResolvedConfig> {
  const cwdAbs = path.resolve(cwd || process.cwd());
  assertNonEmpty("cwdAbs", cwdAbs);

  const configPath = path.join(cwdAbs, "promptfarm.config.json");
  let userCfg: PromptFarmConfig = {};
  let configFound = false;

  try {
    const txt = await fs.readFile(configPath, "utf8");
    configFound = true;
    userCfg = JSON.parse(txt);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code !== "ENOENT") {
      throw new Error(`[promptfarm] failed to load ${configPath}: ${e?.message ?? String(err)}`);
    }
  }

  const promptsDir = normalizeString("paths.promptsDir", userCfg.paths?.promptsDir, DEFAULTS.paths.promptsDir);
  const testsDir = normalizeString("paths.testsDir", userCfg.paths?.testsDir, DEFAULTS.paths.testsDir);
  const distDir = normalizeString("paths.distDir", userCfg.paths?.distDir, DEFAULTS.paths.distDir);
  const promptFiles = normalizeString("globs.promptFiles", userCfg.globs?.promptFiles, DEFAULTS.globs.promptFiles);
  const testFiles = normalizeString("globs.testFiles", userCfg.globs?.testFiles, DEFAULTS.globs.testFiles);

  const promptsDirAbs = path.resolve(cwdAbs, promptsDir);
  const testsDirAbs = path.resolve(cwdAbs, testsDir);
  const distDirAbs = path.resolve(cwdAbs, distDir);

  const promptFilesNorm = promptFiles.replaceAll("\\", "/").replace(/^\/+/, "");
  const testFilesNorm = testFiles.replaceAll("\\", "/").replace(/^\/+/, "");
  const promptGlobAbs = `${promptsDirAbs.replaceAll("\\", "/")}/${promptFilesNorm}`;
  const testGlobAbs = `${testsDirAbs.replaceAll("\\", "/")}/${testFilesNorm}`;

  assertNonEmpty("promptsDirAbs", promptsDirAbs);
  assertNonEmpty("testsDirAbs", testsDirAbs);
  assertNonEmpty("distDirAbs", distDirAbs);
  assertNonEmpty("promptGlobAbs", promptGlobAbs);
  assertNonEmpty("testGlobAbs", testGlobAbs);

  return {
    cwdAbs,
    configPath,
    configFound,
    promptsDir,
    testsDir,
    distDir,
    promptFiles,
    testFiles,
    promptsDirAbs,
    testsDirAbs,
    distDirAbs,
    promptGlobAbs,
    testGlobAbs,
  };
}
