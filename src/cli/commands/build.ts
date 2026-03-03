import { Command } from "commander";
import path from "node:path";
import fs from "node:fs/promises";
import { loadPromptFiles } from "../../core/load";
import { validateLoadedPrompts } from "../../core/validate";
import { buildIndex } from "../../core/compile";
import { renderGeneric } from "../../core/render/generic";

export function cmdBuild(): Command {
  const c = new Command("build")
    .description("Build dist artifacts from prompts")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--pattern <glob>", "Glob pattern", "prompts/**/*.prompt.yaml")
    .option("--out <dir>", "Output directory", "prompt_dist");

  c.action(async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const outDir = path.resolve(cwd, opts.out);

    const files = await loadPromptFiles({ cwd, pattern: opts.pattern });
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