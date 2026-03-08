import { Command } from "commander";
import path from "node:path";
import fs from "node:fs/promises";
import { loadConfig } from "../../core/config.js";
import { loadPromptFiles } from "../../core/load.js";
import { validateLoadedPrompts } from "../../core/validate.js";
import { buildIndex } from "../../core/compile.js";
import { renderGeneric } from "../../core/render/generic.js";
import { printDebug } from "../debug.js";

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

    // write per-prompt artifacts
    for (const { prompt } of res.prompts) {
      const md = renderGeneric(prompt);
      await fs.writeFile(path.join(outDir, `${prompt.id}.prompt.md`), md, "utf8");
      await fs.writeFile(path.join(outDir, `${prompt.id}.prompt.json`), JSON.stringify(prompt, null, 2), "utf8");
    }

    // write index
    const idx = buildIndex(res.prompts.map((x) => x.prompt));
    await fs.writeFile(path.join(outDir, `index.json`), JSON.stringify(idx, null, 2), "utf8");

    console.log(`✅ Built ${res.prompts.length} prompts → ${path.relative(cwd, outDir)}/`);
  });

  return c;
}
