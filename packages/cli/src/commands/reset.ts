import { Command } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";

type ResetTarget = {
  label: string;
  absPath: string;
};

function assertSafeTarget(cwdAbs: string, targetAbs: string, label: string): void {
  const abs = path.resolve(targetAbs);
  if (abs === cwdAbs) {
    throw new Error(`[promptfarm] reset error: refusing to remove project root (${label})`);
  }

  const rel = path.relative(cwdAbs, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `[promptfarm] reset error: refusing to remove path outside project root (${label}: ${abs})`,
    );
  }
}

function dedupeTargets(targets: ResetTarget[]): ResetTarget[] {
  const seen = new Set<string>();
  const out: ResetTarget[] = [];
  for (const target of targets) {
    if (seen.has(target.absPath)) continue;
    seen.add(target.absPath);
    out.push(target);
  }
  return out;
}

async function confirmReset(labels: string[]): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`This will remove ${labels.join(", ")}. Continue? [y/N] `))
      .trim()
      .toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export function cmdReset(): Command {
  const c = new Command("reset")
    .description("Remove generated artifacts (use --all for full scaffold reset)")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--all", "Also remove prompts/, __tests__/, and promptfarm.config.json")
    .option("--dry-run", "Show paths that would be removed")
    .option("-y, --yes", "Skip confirmation for --all");

  c.action(async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const all = Boolean(opts.all);
    const dryRun = Boolean(opts.dryRun);
    const yes = Boolean(opts.yes);

    const targets = dedupeTargets([
      {
        label: "dist/",
        absPath: path.join(cwd, "dist"),
      },
      ...(all
        ? [
            {
              label: "prompts/",
              absPath: path.join(cwd, "prompts"),
            },
            {
              label: "__tests__/",
              absPath: path.join(cwd, "__tests__"),
            },
            {
              label: "promptfarm.config.json",
              absPath: path.join(cwd, "promptfarm.config.json"),
            },
          ]
        : []),
    ]);

    for (const target of targets) {
      assertSafeTarget(cwd, target.absPath, target.label);
    }

    if (dryRun) {
      console.log(`would remove ${targets.map((x) => x.label).join(", ")}`);
      return;
    }

    if (all && !yes) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error("❌ --all requires confirmation. Re-run with --yes to confirm non-interactively.");
        process.exitCode = 1;
        return;
      }
      const ok = await confirmReset(targets.map((x) => x.label));
      if (!ok) {
        console.log("reset aborted");
        return;
      }
    }

    for (const target of targets) {
      await fs.rm(target.absPath, { recursive: true, force: true });
    }

    console.log(`removed ${targets.map((x) => x.label).join(", ")}`);
  });

  return c;
}
