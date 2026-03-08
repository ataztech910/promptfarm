import { Command } from "commander";
import path from "node:path";
import fs from "node:fs/promises";
import { loadConfig } from "../../core/config.js";
import { loadPromptFiles } from "../../core/load.js";
import { validateLoadedPrompts } from "../../core/validate.js";
import { buildIndex } from "../../core/compile.js";
import { renderGeneric } from "../../core/render/generic.js";
import { printDebug } from "../debug.js";

function toPosixPath(p: string): string {
  return p.replaceAll("\\", "/");
}

export function cmdBuild(): Command {
  const c = new Command("build")
    .description("Build dist artifacts from prompts")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--out <dir>", "Override output directory (defaults to config distDir)")
    .option("--debug", "Print resolved config/paths");

  c.action(async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const cfg = await loadConfig(cwd);
    const outDir = opts.out ? path.resolve(cwd, opts.out) : cfg.distDirAbs;

    const files = await loadPromptFiles({ patternAbs: cfg.promptGlobAbs });
    if (opts.debug) printDebug(cfg, { command: "build", matchedFiles: files.length });
    const res = validateLoadedPrompts(files);

    if (res.issues.length) {
      console.error(`❌ Build blocked by validation errors (${res.issues.length} issues):`);
      for (const i of res.issues) console.error(`- ${i.filepath}: ${i.message}`);
      process.exitCode = 1;
      return;
    }

    await fs.mkdir(outDir, { recursive: true });

    const indexSources: Parameters<typeof buildIndex>[0] = [];

    // write per-prompt artifacts
    for (const { filepath, prompt } of res.prompts) {
      const md = renderGeneric(prompt);
      const markdownAbs = path.join(outDir, `${prompt.id}.prompt.md`);
      const jsonAbs = path.join(outDir, `${prompt.id}.prompt.json`);

      await fs.writeFile(markdownAbs, md, "utf8");
      await fs.writeFile(jsonAbs, JSON.stringify(prompt, null, 2), "utf8");

      let updatedAt: string | undefined;
      try {
        const stat = await fs.stat(filepath);
        updatedAt = stat.mtime.toISOString();
      } catch {
        // keep catalog resilient when source mtime cannot be read
      }

      indexSources.push({
        prompt,
        sourcePath: toPosixPath(path.relative(cwd, filepath)),
        artifactPaths: {
          markdown: toPosixPath(path.relative(cwd, markdownAbs)),
          json: toPosixPath(path.relative(cwd, jsonAbs)),
        },
        updatedAt,
      });
    }

    // write index
    const idx = buildIndex(indexSources);
    await fs.writeFile(path.join(outDir, `index.json`), JSON.stringify(idx, null, 2), "utf8");

    console.log(`✅ Built ${res.prompts.length} prompts → ${path.relative(cwd, outDir)}/`);
  });

  return c;
}
