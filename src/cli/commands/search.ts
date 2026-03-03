import { Command } from "commander";
import path from "node:path";
import { loadPromptFiles } from "../../core/load.js";
import { validateLoadedPrompts } from "../../core/validate.js";

function score(hay: string, q: string): number {
  const s = hay.toLowerCase();
  const qq = q.toLowerCase().trim();
  if (!qq) return 0;
  if (s === qq) return 100;
  if (s.startsWith(qq)) return 50;
  if (s.includes(qq)) return 20;
  return 0;
}

export function cmdSearch(): Command {
  const c = new Command("search")
    .description("Search prompts by id/title/tags")
    .argument("<query>", "Search query")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--pattern <glob>", "Glob pattern", "prompts/**/*.prompt.yaml")
    .option("--limit <n>", "Max results", "10");

  c.action(async (query: string, opts) => {
    const cwd = path.resolve(opts.cwd);
    const files = await loadPromptFiles({ cwd, pattern: opts.pattern });
    const res = validateLoadedPrompts(files);

    if (res.issues.length) {
      console.error(`❌ Validation failed. Run: promptfarm validate`);
      process.exitCode = 1;
      return;
    }

    const limit = Math.max(1, Number(opts.limit) || 10);

    const ranked = res.prompts
      .map(({ prompt }) => {
        const hay = [prompt.id, prompt.title, ...(prompt.tags ?? [])].join(" ");
        return { prompt, s: score(hay, query) };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.prompt.id.localeCompare(b.prompt.id))
      .slice(0, limit);

    if (!ranked.length) {
      console.log("No matches.");
      return;
    }

    for (const r of ranked) {
      const tags = r.prompt.tags?.length ? ` [${r.prompt.tags.join(", ")}]` : "";
      console.log(`${r.prompt.id} — ${r.prompt.title}${tags}`);
    }
  });

  return c;
}