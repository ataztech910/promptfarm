import { Command } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../core/config.js";
import { loadPromptFiles } from "../../core/load.js";
import { validateLoadedPrompts } from "../../core/validate.js";
import {
  collectFilesForPathMode,
  expandWithNearbyFiles,
  findFilesByComponentName,
  resolveExistingPath,
} from "../../core/context/findFiles.js";
import { collectFilesFromGitDiff } from "../../core/context/gitContext.js";
import { deriveContextNotes, formatContextMarkdown, type ContextMode } from "../../core/context/formatContext.js";
import type { TemplateVars } from "../../core/template.js";
import { printDebug } from "../debug.js";

function parseSet(values: string[] | undefined): TemplateVars {
  const vars: TemplateVars = {};
  for (const item of values ?? []) {
    const eq = item.indexOf("=");
    if (eq <= 0) continue;
    const k = item.slice(0, eq).trim();
    const v = item.slice(eq + 1).trim();
    vars[k] = v;
  }
  return vars;
}

function stringVar(vars: TemplateVars, key: string): string | undefined {
  const value = vars[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}

type ContextSelection = {
  mode: ContextMode;
  requestedTarget: string;
  files: string[];
  notes: string[];
};

async function inferFromPromptInputs(
  cwdAbs: string,
  promptId: string,
  vars: TemplateVars,
  extraIgnoredDirNames: string[],
): Promise<ContextSelection | undefined> {
  const directKeys: Array<{ key: "path" | "module"; label: string }> = [
    { key: "path", label: "path" },
    { key: "module", label: "module" },
  ];

  for (const item of directKeys) {
    const value = stringVar(vars, item.key);
    if (!value) continue;

    const resolved = await resolveExistingPath(cwdAbs, value);
    if (!resolved) continue;

    const pathRes = await collectFilesForPathMode(cwdAbs, value, {
      extraIgnoredDirNames,
    });

    return {
      mode: "prompt-aware",
      requestedTarget: `prompt=${promptId} inferred from ${item.label}=${value}`,
      files: pathRes.files,
      notes: [`Inferred context target from input key "${item.label}".`, ...pathRes.notes],
    };
  }

  const component = stringVar(vars, "component");
  if (component) {
    const directComponentPath = await resolveExistingPath(cwdAbs, component);
    if (directComponentPath) {
      const pathRes = await collectFilesForPathMode(cwdAbs, component, {
        extraIgnoredDirNames,
      });

      return {
        mode: "prompt-aware",
        requestedTarget: `prompt=${promptId} inferred from component=${component}`,
        files: pathRes.files,
        notes: ["Component value resolved to an existing path.", ...pathRes.notes],
      };
    }

    const matches = await findFilesByComponentName(cwdAbs, component, {
      maxMatches: 10,
      extraIgnoredDirNames,
    });

    if (matches.length > 0) {
      const expanded = await expandWithNearbyFiles(matches, {
        extraCap: 16,
        perDirCap: 3,
        extraIgnoredDirNames,
      });

      const notes = [`Matched ${matches.length} file(s) for component name "${component}".`];
      if (expanded.length > matches.length) {
        notes.push(`Included ${expanded.length - matches.length} nearby file(s) from matching directories.`);
      }

      return {
        mode: "prompt-aware",
        requestedTarget: `prompt=${promptId} inferred from component=${component}`,
        files: expanded,
        notes,
      };
    }
  }

  const target = stringVar(vars, "target");
  if (target) {
    const directTargetPath = await resolveExistingPath(cwdAbs, target);
    if (directTargetPath) {
      const pathRes = await collectFilesForPathMode(cwdAbs, target, {
        extraIgnoredDirNames,
      });

      return {
        mode: "prompt-aware",
        requestedTarget: `prompt=${promptId} inferred from target=${target}`,
        files: pathRes.files,
        notes: ['Inferred context target from input key "target".', ...pathRes.notes],
      };
    }

    const targetMatches = await findFilesByComponentName(cwdAbs, target, {
      maxMatches: 8,
      extraIgnoredDirNames,
    });

    if (targetMatches.length > 0) {
      const expanded = await expandWithNearbyFiles(targetMatches, {
        extraCap: 12,
        perDirCap: 2,
        extraIgnoredDirNames,
      });

      const notes = [`Matched ${targetMatches.length} file(s) for target \"${target}\".`];
      if (expanded.length > targetMatches.length) {
        notes.push(`Included ${expanded.length - targetMatches.length} nearby file(s) from matching directories.`);
      }

      return {
        mode: "prompt-aware",
        requestedTarget: `prompt=${promptId} inferred from target=${target}`,
        files: expanded,
        notes,
      };
    }
  }

  return undefined;
}

function countSelectedModes(opts: { path?: string; fromGitDiff?: boolean; for?: string }): number {
  let count = 0;
  if (opts.path && opts.path.trim().length > 0) count += 1;
  if (opts.fromGitDiff) count += 1;
  if (opts.for && opts.for.trim().length > 0) count += 1;
  return count;
}

export function cmdContext(): Command {
  const c = new Command("context")
    .description("Generate a local context bundle for AI-assisted development")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--path <path>", "Analyze a file or directory path")
    .option("--from-git-diff", "Infer context from local git diff")
    .option("--include-untracked", "Include untracked files with --from-git-diff")
    .option("--for <id>", "Prompt id for prompt-aware context")
    .option("--set <k=v...>", "Prompt input variable (repeatable)", (v, acc: string[]) => {
      acc.push(v);
      return acc;
    }, [])
    .option("--out <path>", "Write markdown output to file")
    .option("--debug", "Print resolved config/paths");

  c.action(async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const cfg = await loadConfig(cwd);
    if (opts.debug) printDebug(cfg, { command: "context" });

    const selectedModes = countSelectedModes({
      path: opts.path,
      fromGitDiff: Boolean(opts.fromGitDiff),
      for: opts.for,
    });

    if (selectedModes === 0) {
      console.error("❌ Choose one mode: --path <path> | --from-git-diff | --for <prompt-id> with --set");
      process.exitCode = 1;
      return;
    }

    if (selectedModes > 1) {
      console.error("❌ Modes are mutually exclusive. Use only one of: --path, --from-git-diff, --for");
      process.exitCode = 1;
      return;
    }

    const extraIgnoredDirNames = [cfg.distDir];

    let selection: ContextSelection;

    if (opts.path && opts.path.trim().length > 0) {
      try {
        const res = await collectFilesForPathMode(cwd, opts.path, {
          extraIgnoredDirNames,
        });

        selection = {
          mode: "path",
          requestedTarget: opts.path,
          files: res.files,
          notes: res.notes,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`❌ ${message}`);
        process.exitCode = 1;
        return;
      }
    } else if (opts.fromGitDiff) {
      try {
        const gitRes = await collectFilesFromGitDiff(cwd, {
          extraIgnoredDirNames,
          includeUntracked: Boolean(opts.includeUntracked),
        });

        selection = {
          mode: "git-diff",
          requestedTarget: opts.includeUntracked
            ? "local git diff (staged + unstaged) + untracked"
            : "local git diff (staged + unstaged)",
          files: gitRes.changedFiles,
          notes: gitRes.notes,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`❌ ${message}`);
        process.exitCode = 1;
        return;
      }
    } else {
      const promptId = `${opts.for ?? ""}`.trim();
      const vars = parseSet(opts.set);

      if (!promptId) {
        console.error("❌ --for requires a prompt id.");
        process.exitCode = 1;
        return;
      }

      const loaded = await loadPromptFiles({ patternAbs: cfg.promptGlobAbs });
      const res = validateLoadedPrompts(loaded);
      if (res.issues.length) {
        console.error("❌ Validation failed. Run: promptfarm validate");
        process.exitCode = 1;
        return;
      }

      const foundPrompt = res.prompts.find((p) => p.prompt.id === promptId)?.prompt;
      if (!foundPrompt) {
        console.error(`❌ Prompt not found: ${promptId}`);
        console.error(`Available: ${res.prompts.map((p) => p.prompt.id).join(", ")}`);
        process.exitCode = 1;
        return;
      }

      const inferred = await inferFromPromptInputs(cwd, promptId, vars, extraIgnoredDirNames);
      if (!inferred) {
        console.error(
          "❌ Could not infer a usable path/context from prompt inputs. Provide one of: path, module, component, or target via --set.",
        );
        process.exitCode = 1;
        return;
      }

      selection = inferred;
    }

    if (!selection.files.length && selection.mode !== "git-diff") {
      console.error("❌ No relevant files found for the selected mode.");
      process.exitCode = 1;
      return;
    }

    const derivedNotes =
      selection.files.length > 0
        ? deriveContextNotes(selection.files, cfg.cwdAbs, {
            testsDirName: path.basename(cfg.testsDir),
          })
        : [];

    const markdown = formatContextMarkdown(
      {
        mode: selection.mode,
        requestedTarget: selection.requestedTarget,
        files: selection.files,
        notes: unique([...selection.notes, ...derivedNotes]),
      },
      cfg.cwdAbs,
    );

    if (opts.out && `${opts.out}`.trim().length > 0) {
      const outAbs = path.resolve(cwd, opts.out);
      await fs.mkdir(path.dirname(outAbs), { recursive: true });
      await fs.writeFile(outAbs, markdown, "utf8");
      console.log(`✅ Context bundle written: ${path.relative(cwd, outAbs)}`);
      return;
    }

    process.stdout.write(markdown);
  });

  return c;
}
