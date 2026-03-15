import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { PromptSchema as DomainPromptSchema } from "../domain/index.js";
import { PromptSchema as LegacyPromptSchema } from "../types/prompts.js";
import { loadConfig } from "./config.js";
import { loadPromptFiles } from "./load.js";
import { resolveAllRuntimeFromFiles } from "./runtimePipeline.js";

export type DoctorStatus = "success" | "warning" | "error";

export type DoctorCheckResult = {
  status: DoctorStatus;
  message: string;
  details?: string[];
};

export type DoctorReport = {
  checks: DoctorCheckResult[];
  hasWarnings: boolean;
  hasErrors: boolean;
};

async function pathExists(filepath: string): Promise<boolean> {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

async function dirExists(dirpath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirpath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function toPosix(p: string): string {
  return p.replaceAll("\\", "/");
}

function nodeMajor(version: string): number {
  const major = Number.parseInt(version.replace(/^v/, "").split(".")[0] ?? "", 10);
  return Number.isFinite(major) ? major : 0;
}

export async function runDoctorChecks(cwd: string): Promise<DoctorReport> {
  const checks: DoctorCheckResult[] = [];
  let cfg;
  try {
    cfg = await loadConfig(cwd);
  } catch (error) {
    checks.push({
      status: "error",
      message: "config load failed",
      details: [error instanceof Error ? error.message : String(error)],
    });
    return {
      checks,
      hasWarnings: false,
      hasErrors: true,
    };
  }

  const major = nodeMajor(process.version);
  if (major >= 18) {
    checks.push({
      status: "success",
      message: `Node version: ${process.version}`,
    });
  } else {
    checks.push({
      status: "error",
      message: "Node version too old",
      details: ["Required: >=18"],
    });
  }

  if (cfg.configFound) {
    checks.push({
      status: "success",
      message: `config: ${path.basename(cfg.configPath)}`,
    });
  } else {
    checks.push({
      status: "error",
      message: "config not found",
      details: ["Run: promptfarm init"],
    });

    return {
      checks,
      hasWarnings: false,
      hasErrors: true,
    };
  }

  const promptsDirOk = await dirExists(cfg.promptsDirAbs);
  if (!promptsDirOk) {
    checks.push({
      status: "error",
      message: "prompts directory missing",
    });
  } else {
    try {
      const promptFiles = await loadPromptFiles({ patternAbs: cfg.promptGlobAbs });
      checks.push({
        status: "success",
        message: `prompts: ${promptFiles.length} found`,
      });

      if (promptFiles.length === 0) {
        checks.push({
          status: "warning",
          message: "no prompt files matched configured glob",
          details: [cfg.promptGlobAbs],
        });
      } else {
        const legacyFilepaths = promptFiles
          .filter((file) => {
            const isDomain = DomainPromptSchema.safeParse(file.raw).success;
            if (isDomain) return false;
            return LegacyPromptSchema.safeParse(file.raw).success;
          })
          .map((file) => path.relative(cfg.cwdAbs, file.filepath) || file.filepath);

        if (legacyFilepaths.length > 0) {
          checks.push({
            status: "warning",
            message: "legacy prompt format detected (transitional adapter in use)",
            details: legacyFilepaths.map((filepath) => `- ${toPosix(filepath)}`),
          });
        } else {
          checks.push({
            status: "success",
            message: "prompt format: promptfarm/v1 canonical",
          });
        }

        const runtime = resolveAllRuntimeFromFiles(promptFiles, cfg.cwdAbs);
        if (runtime.issues.length > 0) {
          checks.push({
            status: "error",
            message: "runtime pipeline issues detected",
            details: runtime.issues.slice(0, 20).map((issue) => {
              const rel = path.isAbsolute(issue.filepath)
                ? path.relative(cfg.cwdAbs, issue.filepath) || issue.filepath
                : issue.filepath;
              return `- ${toPosix(rel)}: ${issue.message}`;
            }),
          });
        } else {
          checks.push({
            status: "success",
            message: `runtime resolve: ${runtime.contexts.length} prompt(s)`,
          });
        }
      }
    } catch (error) {
      checks.push({
        status: "error",
        message: "failed to load prompt files",
        details: [error instanceof Error ? error.message : String(error)],
      });
    }
  }

  const testsDirOk = await dirExists(cfg.testsDirAbs);
  if (!testsDirOk) {
    checks.push({
      status: "error",
      message: "tests directory missing",
    });
  } else {
    const testPattern = `${toPosix(cfg.testsDirAbs)}/**/*.test.yaml`;
    const testFiles = await fg(testPattern, { onlyFiles: true });
    if (testFiles.length === 0) {
      checks.push({
        status: "warning",
        message: "tests: none found",
      });
    } else {
      checks.push({
        status: "success",
        message: `tests: ${testFiles.length} found`,
      });
    }
  }

  const distDirOk = await dirExists(cfg.distDirAbs);
  const indexPathAbs = path.join(cfg.distDirAbs, "index.json");
  const indexFileOk = await pathExists(indexPathAbs);
  if (distDirOk && indexFileOk) {
    const relIndexPath = toPosix(path.relative(cfg.cwdAbs, indexPathAbs));
    checks.push({
      status: "success",
      message: `build artifacts: ${relIndexPath}`,
    });
  } else {
    checks.push({
      status: "warning",
      message: "build artifacts missing",
      details: ["Suggestion: run `promptfarm build`"],
    });
  }

  return {
    checks,
    hasWarnings: checks.some((check) => check.status === "warning"),
    hasErrors: checks.some((check) => check.status === "error"),
  };
}
