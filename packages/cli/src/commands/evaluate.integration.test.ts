import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cmdEvaluate } from "./evaluate.js";

type CommandRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

async function runEvaluateCommand(args: string[]): Promise<CommandRunResult> {
  const command = cmdEvaluate();
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

async function setupEvaluationProject(opts: {
  prompts: Array<{ filename: string; body: string }>;
}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-evaluate-cli-"));
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

  for (const prompt of opts.prompts) {
    await fs.writeFile(path.join(promptsDir, prompt.filename), prompt.body, "utf8");
  }

  return root;
}

test("evaluate command outputs structured report for resolved prompt", async () => {
  const cwd = await setupEvaluationProject({
    prompts: [
      {
        filename: "base.prompt.yaml",
        body: `apiVersion: promptfarm/v1
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
      },
      {
        filename: "architecture_review.prompt.yaml",
        body: `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: architecture_review
  version: 1.0.0
spec:
  artifact:
    type: instruction
  inputs:
    - name: system_name
      type: string
      required: true
  messages:
    - role: user
      content: Review {{system_name}}.
  use:
    - prompt: base
  evaluation:
    reviewerRoles:
      - id: manager
      - id: senior_engineer
      - id: consultant
    rubric:
      criteria:
        - id: correctness
          title: Correctness
          maxScore: 5
          weight: 2
        - id: actionability
          title: Actionability
          maxScore: 5
          weight: 1
    qualityGates:
      - metric: overall
        operator: ">="
        threshold: 0
      - metric: criterion
        criterionId: correctness
        operator: ">="
        threshold: 0
`,
      },
    ],
  });

  try {
    const run = await runEvaluateCommand(["architecture_review", "--cwd", cwd, "--format", "json"]);
    assert.equal(run.exitCode, 0);

    const json = JSON.parse(run.stdout) as {
      command: string;
      reports: Array<{
        run: { dependencyOrder: string[] };
        reviewerResults: unknown[];
        aggregated: { verdict: string };
      }>;
      summary: { total: number; failed: number; succeeded: number };
    };

    assert.equal(json.command, "evaluate");
    assert.equal(json.summary.total, 1);
    assert.equal(json.summary.failed, 0);
    assert.equal(json.summary.succeeded, 1);
    assert.deepEqual(json.reports[0]?.run.dependencyOrder, ["base", "architecture_review"]);
    assert.equal(json.reports[0]?.reviewerResults.length, 3);
    assert.equal(json.reports[0]?.aggregated.verdict, "pass");
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("evaluate command fails for prompt without evaluation spec", async () => {
  const cwd = await setupEvaluationProject({
    prompts: [
      {
        filename: "plain.prompt.yaml",
        body: `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: plain
  version: 1.0.0
spec:
  artifact:
    type: instruction
  inputs: []
  messages:
    - role: user
      content: Hello
  use: []
`,
      },
    ],
  });

  try {
    const run = await runEvaluateCommand(["plain", "--cwd", cwd, "--format", "json"]);
    assert.equal(run.exitCode, 1);

    const json = JSON.parse(run.stdout) as {
      command: string;
      reports: unknown[];
      summary: { failed: number };
      issues: Array<{ severity: string; message: string }>;
    };

    assert.equal(json.command, "evaluate");
    assert.equal(json.reports.length, 0);
    assert.equal(json.summary.failed, 1);
    assert.equal(json.issues[0]?.severity, "error");
    assert.match(json.issues[0]?.message ?? "", /has no spec\.evaluation configured/);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
