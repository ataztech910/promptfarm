import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cmdBlueprint } from "./blueprint.js";

type CommandRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

async function runBlueprintCommand(args: string[]): Promise<CommandRunResult> {
  const command = cmdBlueprint();
  const stdout: string[] = [];
  const stderr: string[] = [];

  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const previousExitCode = process.exitCode;

  console.log = (...line: unknown[]) => {
    stdout.push(`${line.map(String).join(" ")}\n`);
  };
  console.error = (...line: unknown[]) => {
    stderr.push(`${line.map(String).join(" ")}\n`);
  };
  console.warn = (...line: unknown[]) => {
    stderr.push(`${line.map(String).join(" ")}\n`);
  };

  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    stdout.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;

  process.exitCode = undefined;

  try {
    await command.parseAsync(args, { from: "user" });
    return {
      exitCode: process.exitCode ?? 0,
      stdout: stdout.join(""),
      stderr: stderr.join(""),
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    process.stdout.write = originalStdoutWrite;
    process.exitCode = previousExitCode;
  }
}

async function setupBlueprintProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-blueprint-cli-"));
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
  inputs: []
  messages:
    - role: system
      content: Base guidance.
  use: []
`,
    "utf8",
  );

  await fs.writeFile(
    path.join(promptsDir, "codegen.prompt.yaml"),
    `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: codegen
  version: 1.0.0
spec:
  artifact:
    type: code
  inputs:
    - name: project_name
      type: string
      required: true
  messages:
    - role: user
      content: Generate code for {{project_name}}.
  use:
    - prompt: base
  evaluation:
    reviewerRoles:
      - id: manager
    rubric:
      criteria:
        - id: correctness
          title: Correctness
          maxScore: 5
          weight: 1
    qualityGates:
      - metric: overall
        operator: ">="
        threshold: 0
`,
    "utf8",
  );

  await fs.writeFile(
    path.join(promptsDir, "course_plan.prompt.yaml"),
    `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: course_plan
  version: 1.0.0
spec:
  artifact:
    type: course
  inputs: []
  messages:
    - role: user
      content: Create a course plan.
  use:
    - prompt: base
`,
    "utf8",
  );

  return root;
}

test("blueprint command generates structured reports for resolved prompts", async () => {
  const cwd = await setupBlueprintProject();

  try {
    const run = await runBlueprintCommand(["--cwd", cwd, "--format", "json"]);
    assert.equal(run.exitCode, 0);

    const json = JSON.parse(run.stdout) as {
      command: string;
      reports: Array<{
        promptId: string;
        artifactType: string;
        evaluation?: { verdict: string };
        blueprint: { artifactType: string };
      }>;
      summary: { total: number; withEvaluation: number; errors: number };
      issues: Array<{ severity: string; message: string }>;
    };

    assert.equal(json.command, "blueprint");
    assert.equal(json.summary.total, 3);
    assert.equal(json.summary.withEvaluation, 1);
    assert.equal(json.summary.errors, 0);
    assert.equal(json.issues.length, 0);

    const codegen = json.reports.find((report) => report.promptId === "codegen");
    assert.equal(codegen?.artifactType, "code");
    assert.equal(codegen?.blueprint.artifactType, "code");
    assert.equal(codegen?.evaluation?.verdict, "pass");

    const course = json.reports.find((report) => report.promptId === "course_plan");
    assert.equal(course?.artifactType, "course");
    assert.equal(course?.blueprint.artifactType, "course");
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("blueprint command fails when prompt id is missing", async () => {
  const cwd = await setupBlueprintProject();

  try {
    const run = await runBlueprintCommand(["missing_prompt", "--cwd", cwd, "--format", "json"]);
    assert.equal(run.exitCode, 1);
    assert.match(run.stderr, /Prompt not found: missing_prompt/);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
