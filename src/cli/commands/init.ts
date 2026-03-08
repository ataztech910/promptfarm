import { Command } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../core/config.js";

const DEFAULT_CONFIG_JSON = `${JSON.stringify(
  {
    paths: {
      promptsDir: "prompts",
      testsDir: "__tests__",
      distDir: "dist",
    },
  },
  null,
  2,
)}\n`;

const EXAMPLE_PROMPT = `id: explain_topic
title: Explain topic
version: 0.1.0

inputs:
  topic:
    type: string
    required: true

messages:
  - role: system
    content: |
      You are a pragmatic senior engineer.

  - role: user
    content: |
      Explain {{topic}} to senior engineers.
      Include trade-offs and a simple example.
`;

function toRel(cwdAbs: string, targetAbs: string): string {
  return path.relative(cwdAbs, targetAbs) || ".";
}

type CreateState = {
  created: string[];
  skipped: string[];
  overwritten: string[];
};

type PathKind = "file" | "dir" | "missing";

async function getPathKind(absPath: string): Promise<PathKind> {
  try {
    const st = await fs.stat(absPath);
    if (st.isDirectory()) return "dir";
    return "file";
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "ENOENT") return "missing";
    throw err;
  }
}

async function writeFileIfNeeded(opts: {
  filepath: string;
  content: string;
  force: boolean;
  state: CreateState;
  cwdAbs: string;
}): Promise<void> {
  const rel = toRel(opts.cwdAbs, opts.filepath);
  const kind = await getPathKind(opts.filepath);
  const hasFile = kind !== "missing";

  if (kind === "dir") {
    throw new Error(`[promptfarm] init error: expected file path but found directory: ${rel}`);
  }

  if (hasFile && !opts.force) {
    opts.state.skipped.push(rel);
    return;
  }

  await fs.writeFile(opts.filepath, opts.content, "utf8");
  if (hasFile) {
    opts.state.overwritten.push(rel);
  } else {
    opts.state.created.push(rel);
  }
}

async function mkdirIfNeeded(opts: {
  dirpath: string;
  state: CreateState;
  cwdAbs: string;
}): Promise<void> {
  const rel = toRel(opts.cwdAbs, opts.dirpath);
  const kind = await getPathKind(opts.dirpath);
  if (kind === "dir") {
    opts.state.skipped.push(`${rel}/`);
    return;
  }
  if (kind === "file") {
    throw new Error(`[promptfarm] init error: expected directory path but found file: ${rel}`);
  }
  await fs.mkdir(opts.dirpath, { recursive: true });
  opts.state.created.push(`${rel}/`);
}

function printList(title: string, rows: string[]): void {
  console.log(`${title}:`);
  if (!rows.length) {
    console.log("- (none)");
    return;
  }
  for (const row of rows) {
    console.log(`- ${row}`);
  }
}

export function cmdInit(): Command {
  const c = new Command("init")
    .description("Initialize PromptFarm config, directories, and starter prompt")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--force", "Overwrite existing files");

  c.action(async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const force = Boolean(opts.force);
    const state: CreateState = { created: [], skipped: [], overwritten: [] };

    const configPath = path.join(cwd, "promptfarm.config.json");
    await writeFileIfNeeded({
      filepath: configPath,
      content: DEFAULT_CONFIG_JSON,
      force,
      state,
      cwdAbs: cwd,
    });

    const cfg = await loadConfig(cwd);

    await mkdirIfNeeded({
      dirpath: cfg.promptsDirAbs,
      state,
      cwdAbs: cfg.cwdAbs,
    });
    await mkdirIfNeeded({
      dirpath: cfg.testsDirAbs,
      state,
      cwdAbs: cfg.cwdAbs,
    });

    const examplePromptPath = path.join(cfg.promptsDirAbs, "explain_topic.prompt.yaml");
    await writeFileIfNeeded({
      filepath: examplePromptPath,
      content: EXAMPLE_PROMPT,
      force,
      state,
      cwdAbs: cfg.cwdAbs,
    });

    console.log("PromptFarm initialized.");
    console.log("");
    printList("Created", state.created);
    console.log("");
    printList("Skipped", state.skipped);
    if (force) {
      console.log("");
      printList("Overwritten", state.overwritten);
    }
    console.log("");
    console.log("Next steps:");
    console.log("  promptfarm validate");
    console.log("  promptfarm render explain_topic --set topic=CQRS");
  });

  return c;
}
