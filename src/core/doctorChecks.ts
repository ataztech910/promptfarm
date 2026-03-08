import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { loadConfig } from "./config.js";

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
  const cfg = await loadConfig(cwd);

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
    const promptPattern = `${toPosix(cfg.promptsDirAbs)}/**/*.prompt.yaml`;
    const promptFiles = await fg(promptPattern, { onlyFiles: true });
    checks.push({
      status: "success",
      message: `prompts: ${promptFiles.length} found`,
    });
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
