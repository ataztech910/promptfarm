import { Command } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { loadConfig } from "../../core/config.js";
import { discoverTemplates } from "../../core/discoverTemplates.js";
import { detectProject } from "../../core/projectDetect.js";
import { validateLoadedPrompts } from "../../core/validate.js";
import { writePromptFiles } from "../../core/writePromptFiles.js";
import type { LoadedPromptFile } from "../../core/load.js";
import { printDebug } from "../debug.js";

function detectionLabel(framework: "nextjs" | "unknown", language: "typescript" | "javascript"): string {
  const frameworkLabel = framework === "nextjs" ? "Next.js" : "unknown";
  const languageLabel = language === "typescript" ? "TypeScript" : "JavaScript";
  return `${frameworkLabel} + ${languageLabel}`;
}

function plural(n: number, singular: string, pluralForm: string): string {
  return n === 1 ? singular : pluralForm;
}

async function validateWrittenPrompts(filepaths: string[]): Promise<string[]> {
  if (!filepaths.length) return [];

  const loaded: LoadedPromptFile[] = [];
  for (const filepath of filepaths) {
    const txt = await fs.readFile(filepath, "utf8");
    loaded.push({
      filepath,
      raw: YAML.parse(txt),
    });
  }

  const res = validateLoadedPrompts(loaded);
  return res.issues.map((i) => `${i.filepath}: ${i.message}`);
}

export function cmdDiscover(): Command {
  const c = new Command("discover")
    .description("Discover project characteristics and generate starter prompt files")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--force", "Overwrite existing prompt files")
    .option("--debug", "Print resolved config/paths and detection evidence");

  c.action(async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const cfg = await loadConfig(cwd);
    if (opts.debug) printDebug(cfg, { command: "discover" });

    const detection = await detectProject(cfg.cwdAbs);
    const templates = discoverTemplates(detection);

    if (!templates.length) {
      console.log(`detected: ${detectionLabel(detection.framework, detection.language)}`);
      console.log("created: 0 files");
      console.log("skipped: 0 existing files");
      return;
    }

    const writeRes = await writePromptFiles({
      promptsDirAbs: cfg.promptsDirAbs,
      templates,
      force: Boolean(opts.force),
    });

    for (const filepath of writeRes.created) {
      console.log(`created: ${path.relative(cfg.cwdAbs, filepath)}`);
    }
    for (const filepath of writeRes.skipped) {
      console.log(`skipped existing: ${path.relative(cfg.cwdAbs, filepath)}`);
    }
    for (const filepath of writeRes.overwritten) {
      console.log(`overwritten: ${path.relative(cfg.cwdAbs, filepath)}`);
    }

    const validationIssues = await validateWrittenPrompts([
      ...writeRes.created,
      ...writeRes.overwritten,
    ]);
    if (validationIssues.length) {
      console.error("❌ Generated prompt files failed validation:");
      for (const issue of validationIssues) console.error(`- ${issue}`);
      process.exitCode = 1;
      return;
    }

    console.log(`detected: ${detectionLabel(detection.framework, detection.language)}`);
    console.log(
      `created: ${writeRes.created.length} ${plural(writeRes.created.length, "file", "files")}`,
    );
    console.log(
      `skipped: ${writeRes.skipped.length} existing ${plural(
        writeRes.skipped.length,
        "file",
        "files",
      )}`,
    );

    if (opts.force) {
      console.log(
        `overwritten: ${writeRes.overwritten.length} ${plural(
          writeRes.overwritten.length,
          "file",
          "files",
        )}`,
      );
    }

    if (opts.debug && detection.evidence.length) {
      for (const item of detection.evidence) {
        console.error(`[promptfarm:debug] detect=${item}`);
      }
    }
  });

  return c;
}
