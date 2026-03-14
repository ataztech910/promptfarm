import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cmdBuild } from "./build.js";

type CommandRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

async function runBuildCommand(args: string[]): Promise<CommandRunResult> {
  const command = cmdBuild();
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

async function setupBuildProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-build-cli-"));
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
    path.join(promptsDir, "code.prompt.yaml"),
    `apiVersion: promptfarm/v1
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
    "utf8",
  );

  await fs.writeFile(
    path.join(promptsDir, "instruction.prompt.yaml"),
    `apiVersion: promptfarm/v1
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
      content: Build instruction.
  use: []
`,
    "utf8",
  );

  return root;
}

test("build command uses blueprint builders and writes final artifacts", async () => {
  const cwd = await setupBuildProject();

  try {
    const run = await runBuildCommand(["--cwd", cwd]);
    assert.equal(run.exitCode, 0);
    assert.match(run.stdout, /Built 2 prompts/);

    await fs.access(path.join(cwd, "dist/src/code_item.ts"));
    await fs.access(path.join(cwd, "dist/instruction_item.instruction.md"));
    await fs.access(path.join(cwd, "dist/code_item.prompt.json"));
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("build command supports JSON report output contract", async () => {
  const cwd = await setupBuildProject();

  try {
    const run = await runBuildCommand(["--cwd", cwd, "--format", "json"]);
    assert.equal(run.exitCode, 0);

    const json = JSON.parse(run.stdout) as {
      command: string;
      summary: { total: number; failed: number };
      reports: Array<{ promptId: string; artifactType: string; builtFiles: string[] }>;
      builtFiles: number;
      outputDir: string;
    };

    assert.equal(json.command, "build");
    assert.equal(json.summary.total, 2);
    assert.equal(json.summary.failed, 0);
    assert.equal(json.reports.length, 2);
    assert.ok(json.builtFiles >= 2);
    assert.equal(json.outputDir, "dist");
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
