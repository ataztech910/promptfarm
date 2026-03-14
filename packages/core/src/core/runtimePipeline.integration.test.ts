import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "./config.js";
import { loadPromptFiles } from "./load.js";
import { writeResolvedPromptArtifacts } from "./runtimeBuild.js";
import {
  buildRuntimeExecutionBundle,
  parseAndValidateRuntimePromptFiles,
  resolveRuntimePrompt,
} from "./runtimePipeline.js";
import { renderRuntimePrompt } from "./runtimeRender.js";

async function setupCompositionProject(): Promise<string> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-runtime-int-"));
  const promptsDir = path.join(tmpRoot, "prompts");
  await fs.mkdir(promptsDir, { recursive: true });

  await fs.writeFile(
    path.join(tmpRoot, "promptfarm.config.json"),
    JSON.stringify(
      {
        paths: {
          promptsDir: "prompts",
          distDir: "dist",
          testsDir: "__tests__",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    path.join(promptsDir, "base.prompt.yaml"),
    `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: base
  version: 1.0.0
spec:
  artifact:
    type: instruction
  inputs:
    - name: repo_name
      type: string
      required: true
  messages:
    - role: system
      content: Base rules.
  use: []
`,
    "utf8",
  );

  await fs.writeFile(
    path.join(promptsDir, "consulting_style.prompt.yaml"),
    `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: consulting_style
  version: 1.0.0
spec:
  artifact:
    type: instruction
  inputs:
    - name: audience
      type: string
      required: true
  messages:
    - role: system
      content: Consulting structure.
  use:
    - prompt: base
`,
    "utf8",
  );

  await fs.writeFile(
    path.join(promptsDir, "architecture_review.prompt.yaml"),
    `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: architecture_review
  version: 1.0.0
  title: Architecture review
spec:
  artifact:
    type: instruction
  inputs:
    - name: system_name
      type: string
      required: true
  messages:
    - role: user
      content: Review {{system_name}} for {{audience}} in {{repo_name}}.
  use:
    - prompt: consulting_style
`,
    "utf8",
  );

  return tmpRoot;
}

test("runtime render pipeline resolves composition end-to-end", async () => {
  const cwd = await setupCompositionProject();

  try {
    const cfg = await loadConfig(cwd);
    const files = await loadPromptFiles({ patternAbs: cfg.promptGlobAbs });
    const parsed = parseAndValidateRuntimePromptFiles(files);
    assert.equal(parsed.issues.length, 0);

    const resolved = resolveRuntimePrompt("architecture_review", parsed.records, cwd);
    const rendered = renderRuntimePrompt({
      prompt: resolved.resolvedPrompt,
      vars: {
        system_name: "Billing",
        audience: "CTO",
        repo_name: "billing-api",
      },
      target: "generic",
    });

    assert.equal(rendered.issues.length, 0);
    assert.ok(rendered.output?.includes("Base rules."));
    assert.ok(rendered.output?.includes("Consulting structure."));
    assert.ok(rendered.output?.includes("Review Billing for CTO in billing-api."));
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("runtime build pipeline writes resolved composition artifacts", async () => {
  const cwd = await setupCompositionProject();

  try {
    const cfg = await loadConfig(cwd);
    const files = await loadPromptFiles({ patternAbs: cfg.promptGlobAbs });
    const bundle = buildRuntimeExecutionBundle({ cwd, files });
    assert.equal(bundle.issues.length, 0);
    assert.equal(bundle.contexts.length, 3);

    const result = await writeResolvedPromptArtifacts({
      cwd,
      outDir: cfg.distDirAbs,
      contexts: bundle.contexts,
    });

    assert.equal(result.count, 3);
    assert.equal(result.issues.length, 0);
    assert.ok(result.builtFiles >= 3);

    const md = await fs.readFile(path.join(cfg.distDirAbs, "architecture_review.prompt.md"), "utf8");
    assert.ok(md.includes("Base rules."));
    assert.ok(md.includes("Consulting structure."));

    const jsonText = await fs.readFile(path.join(cfg.distDirAbs, "architecture_review.prompt.json"), "utf8");
    const json = JSON.parse(jsonText) as {
      prompt: { messages: Array<{ role: string; content: string }> };
      resolvedArtifact: { dependencyOrder: string[] };
      blueprint: { artifactType: string };
      buildOutput: { files: Array<{ path: string; content: string }> };
    };

    assert.deepEqual(json.resolvedArtifact.dependencyOrder, ["base", "consulting_style", "architecture_review"]);
    assert.equal(json.prompt.messages.length, 3);
    assert.equal(json.blueprint.artifactType, "instruction");
    assert.equal(json.buildOutput.files.length, 1);

    const builtInstruction = await fs.readFile(path.join(cfg.distDirAbs, "architecture_review.instruction.md"), "utf8");
    assert.match(builtInstruction, /Goal:/);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
