import { Command } from "commander";
import path from "node:path";
import { loadConfig } from "../../core/config.js";
import { loadPromptFiles } from "../../core/load.js";
import { validateLoadedPrompts } from "../../core/validate.js";
import { loadTestFiles } from "../../core/loadTests.js";
import { runPromptTests } from "../../core/testRunner.js";
import { printDebug } from "../debug.js";

function toRel(cwd: string, absOrRel: string): string {
  if (!path.isAbsolute(absOrRel)) return absOrRel;
  return path.relative(cwd, absOrRel) || ".";
}

function toPosixGlob(globPath: string): string {
  return globPath.replaceAll("\\", "/").replace(/^\/+/, "");
}

export function cmdTest(): Command {
  const c = new Command("test")
    .description("Run prompt tests from YAML files")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--debug", "Print resolved config/paths");

  c.action(async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const cfg = await loadConfig(cwd);

    const promptFiles = await loadPromptFiles({ patternAbs: cfg.promptGlobAbs });
    const testLoad = await loadTestFiles({
      patternAbs: cfg.testGlobAbs,
      testsDirAbs: cfg.testsDirAbs,
    });
    const expectedPattern = `${cfg.testsDir.replaceAll("\\", "/")}/${toPosixGlob(cfg.testFiles)}`;
    const expectedExtension = path.posix.basename(toPosixGlob(cfg.testFiles));

    if (opts.debug) {
      printDebug(cfg, {
        command: "test",
        matchedFiles: testLoad.matchedFilepaths.length,
      });
    }

    for (const ignoredFileAbs of testLoad.ignoredFiles) {
      const relToTestsDir = path.relative(cfg.testsDirAbs, ignoredFileAbs) || path.basename(ignoredFileAbs);
      console.warn(`Ignoring file: ${relToTestsDir}`);
      console.warn(`Expected extension: ${expectedExtension}`);
    }

    if (testLoad.matchedFilepaths.length === 0) {
      console.log(`No tests found in ${expectedPattern}`);
      process.exitCode = 1;
      return;
    }

    const promptValidation = validateLoadedPrompts(promptFiles);
    if (promptValidation.issues.length) {
      console.error(`❌ Validation failed. Run: promptfarm validate`);
      process.exitCode = 1;
      return;
    }

    const run = runPromptTests({
      prompts: promptValidation.prompts,
      testFiles: testLoad.files,
      loadIssues: testLoad.issues,
    });

    for (const result of run.cases) {
      if (result.passed) {
        console.log(`✓ ${result.promptId} / ${result.caseName}`);
        continue;
      }

      console.log(`✗ ${result.promptId} / ${result.caseName}`);

      if (result.missingExpected.length) {
        console.log("  Missing expected text:");
        for (const missing of result.missingExpected) {
          console.log(`  - ${missing}`);
        }
      }

      if (result.error) {
        console.log(`  ${result.error}`);
      }
    }

    for (const issue of run.issues) {
      const rel = toRel(cwd, issue.filepath);
      console.log(`✗ ${rel}`);
      for (const line of issue.message.split("\n")) {
        console.log(`  ${line}`);
      }
    }

    console.log(`Passed: ${run.passed}`);
    console.log(`Failed: ${run.failed}`);

    if (run.failed > 0) {
      process.exitCode = 1;
    }
  });

  return c;
}
