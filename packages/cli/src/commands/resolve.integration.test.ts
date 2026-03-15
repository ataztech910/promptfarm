import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cmdResolve } from "./resolve.js";

type CommandRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

async function runResolveCommand(args: string[]): Promise<CommandRunResult> {
  const command = cmdResolve();
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

async function setupResolveProject(opts: {
  prompts: Array<{ filename: string; body: string }>;
}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-resolve-cli-"));
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

test("resolve command outputs resolved runtime artifact in JSON", async () => {
  const cwd = await setupResolveProject({
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
  inputs: []
  messages:
    - role: user
      content: Child prompt.
  use:
    - prompt: base
`,
      },
    ],
  });

  try {
    const run = await runResolveCommand(["child", "--cwd", cwd, "--format", "json"]);
    assert.equal(run.exitCode, 0);

    const json = JSON.parse(run.stdout) as {
      command: string;
      summary: { total: number; failed: number };
      items: Array<{
        promptId: string;
        dependencyOrder: string[];
        resolvedArtifact: { messages: Array<{ content: string }> };
      }>;
    };

    assert.equal(json.command, "resolve");
    assert.equal(json.summary.total, 1);
    assert.equal(json.summary.failed, 0);
    assert.equal(json.items[0]?.promptId, "child");
    assert.deepEqual(json.items[0]?.dependencyOrder, ["base", "child"]);
    assert.equal(json.items[0]?.resolvedArtifact.messages.length, 2);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("resolve command reports missing dependency as runtime issue", async () => {
  const cwd = await setupResolveProject({
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
      content: Child prompt.
  use:
    - prompt: missing_base
`,
      },
    ],
  });

  try {
    const run = await runResolveCommand(["--cwd", cwd, "--format", "json"]);
    assert.equal(run.exitCode, 1);

    const json = JSON.parse(run.stdout) as {
      summary: { failed: number; errors: number };
      issues: Array<{ message: string }>;
    };

    assert.equal(json.summary.failed, 1);
    assert.equal(json.summary.errors, 1);
    assert.match(json.issues[0]?.message ?? "", /missing dependency "missing_base"/);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

