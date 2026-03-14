import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Command } from "commander";
import { cmdList } from "./list.js";
import { cmdTest } from "./test.js";
import { cmdValidate } from "./validate.js";

type CommandRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

async function runCommand(commandFactory: () => Command, cwd: string): Promise<CommandRunResult> {
  const command = commandFactory();
  const stdout: string[] = [];
  const stderr: string[] = [];

  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const previousExitCode = process.exitCode;

  console.log = (...args: unknown[]) => {
    stdout.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    stderr.push(args.map(String).join(" "));
  };
  console.warn = (...args: unknown[]) => {
    stderr.push(args.map(String).join(" "));
  };

  process.exitCode = undefined;

  try {
    await command.parseAsync(["node", command.name(), "--cwd", cwd], { from: "user" });
    return {
      exitCode: process.exitCode ?? 0,
      stdout: stdout.join("\n"),
      stderr: stderr.join("\n"),
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    process.exitCode = previousExitCode;
  }
}

async function setupProject(opts: {
  prompts: Array<{ filename: string; body: string }>;
  tests?: Array<{ filename: string; body: string }>;
}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-cli-runtime-"));
  const promptsDir = path.join(root, "prompts");
  const testsDir = path.join(root, "__tests__");
  await fs.mkdir(promptsDir, { recursive: true });
  await fs.mkdir(testsDir, { recursive: true });

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

  for (const t of opts.tests ?? []) {
    await fs.writeFile(path.join(testsDir, t.filename), t.body, "utf8");
  }

  return root;
}

test("validate uses runtimePipeline and fails on unresolved dependency", async () => {
  const cwd = await setupProject({
    prompts: [
      {
        filename: "child.prompt.yaml",
        body: `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: child
  version: 1.0.0
spec:
  artifact:
    type: instruction
  inputs: []
  messages:
    - role: user
      content: Hello
  use:
    - prompt: missing_base
`,
      },
    ],
  });

  try {
    const run = await runCommand(cmdValidate, cwd);
    assert.equal(run.exitCode, 1);
    assert.match(run.stderr, /missing dependency "missing_base"/);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("list does not bypass validation/runtime resolve", async () => {
  const cwd = await setupProject({
    prompts: [
      {
        filename: "child.prompt.yaml",
        body: `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: child
  version: 1.0.0
spec:
  artifact:
    type: instruction
  inputs: []
  messages:
    - role: user
      content: Hello
  use:
    - prompt: missing_base
`,
      },
    ],
  });

  try {
    const run = await runCommand(cmdList, cwd);
    assert.equal(run.exitCode, 1);
    assert.match(run.stderr, /Validation failed/);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("test command runs against resolved prompts", async () => {
  const cwd = await setupProject({
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
        filename: "child.prompt.yaml",
        body: `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: child
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
`,
      },
    ],
    tests: [
      {
        filename: "child.test.yaml",
        body: `prompt: child
cases:
  - name: includes_base_message
    inputs:
      system_name: Billing
    expect_contains:
      - Base guidance.
      - Review Billing.
`,
      },
    ],
  });

  try {
    const run = await runCommand(cmdTest, cwd);
    assert.equal(run.exitCode, 0);
    assert.match(run.stdout, /✓ child \/ includes_base_message/);
    assert.match(run.stdout, /Passed: 1/);
    assert.match(run.stdout, /Failed: 0/);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
