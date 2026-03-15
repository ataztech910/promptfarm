import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "./config.js";
import { loadPromptFiles } from "./load.js";
import { buildRuntimeExecutionBundle } from "./runtimePipeline.js";
import { writeResolvedPromptArtifacts } from "./runtimeBuild.js";

async function setupBuildProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-runtime-build-int-"));
  const promptsDir = path.join(root, "prompts");
  await fs.mkdir(promptsDir, { recursive: true });

  await fs.writeFile(
    path.join(root, "promptfarm.config.json"),
    JSON.stringify(
      {
        paths: {
          promptsDir: "prompts",
          testsDir: "__tests__",
          distDir: "dist",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const prompts = [
    {
      filename: "code.prompt.yaml",
      body: `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: code_item
  version: 1.0.0
spec:
  artifact:
    type: code
  inputs: []
  messages:
    - role: user
      content: Build code.
  use: []
`,
    },
    {
      filename: "book.prompt.yaml",
      body: `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: book_item
  version: 1.0.0
spec:
  artifact:
    type: book_text
  inputs: []
  messages:
    - role: user
      content: Build chapter.
  use: []
`,
    },
    {
      filename: "instruction.prompt.yaml",
      body: `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: instruction_item
  version: 1.0.0
spec:
  artifact:
    type: instruction
  inputs: []
  messages:
    - role: user
      content: Build instructions.
  use: []
`,
    },
    {
      filename: "story.prompt.yaml",
      body: `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: story_item
  version: 1.0.0
spec:
  artifact:
    type: story
  inputs: []
  messages:
    - role: user
      content: Build story.
  use: []
`,
    },
    {
      filename: "course.prompt.yaml",
      body: `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: course_item
  version: 1.0.0
spec:
  artifact:
    type: course
  inputs: []
  messages:
    - role: user
      content: Build course.
  use: []
`,
    },
  ] as const;

  for (const prompt of prompts) {
    await fs.writeFile(path.join(promptsDir, prompt.filename), prompt.body, "utf8");
  }

  return root;
}

test("runtime build produces builder outputs for all artifact types", async () => {
  const cwd = await setupBuildProject();

  try {
    const cfg = await loadConfig(cwd);
    const files = await loadPromptFiles({ patternAbs: cfg.promptGlobAbs });
    const runtime = buildRuntimeExecutionBundle({ cwd, files });
    assert.equal(runtime.issues.length, 0);

    const built = await writeResolvedPromptArtifacts({
      cwd,
      outDir: cfg.distDirAbs,
      contexts: runtime.contexts,
    });

    assert.equal(built.issues.length, 0);
    assert.equal(built.count, 5);
    assert.ok(built.builtFiles >= 5);

    await fs.access(path.join(cfg.distDirAbs, "src/code_item.ts"));
    await fs.access(path.join(cfg.distDirAbs, "book_item.book.md"));
    await fs.access(path.join(cfg.distDirAbs, "instruction_item.instruction.md"));
    await fs.access(path.join(cfg.distDirAbs, "story_item.story.md"));
    await fs.access(path.join(cfg.distDirAbs, "course_item.course.md"));
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

