import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cmdDoctor } from "./doctor.js";

type CommandRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

async function runDoctorCommand(args: string[]): Promise<CommandRunResult> {
  const command = cmdDoctor();
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

async function setupDoctorProject(opts: {
  prompts: Array<{ filename: string; body: string }>;
}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-doctor-cli-"));
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

  return root;
}

test("doctor command reports runtime dependency issues", async () => {
  const cwd = await setupDoctorProject({
    prompts: [
      {
        filename: "broken.prompt.yaml",
        body: `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: broken
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
    const run = await runDoctorCommand(["--cwd", cwd, "--format", "json"]);
    assert.equal(run.exitCode, 1);

    const json = JSON.parse(run.stdout) as {
      command: string;
      summary: { errors: number };
      items: Array<{ status: string; message: string; details?: string[] }>;
    };

    assert.equal(json.command, "doctor");
    assert.ok(json.summary.errors >= 1);
    const runtimeCheck = json.items.find((item) => item.message === "runtime pipeline issues detected");
    assert.ok(runtimeCheck);
    assert.match(runtimeCheck?.details?.join("\n") ?? "", /missing dependency "missing_base"/);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("doctor command flags legacy prompt usage as warning", async () => {
  const cwd = await setupDoctorProject({
    prompts: [
      {
        filename: "legacy.prompt.yaml",
        body: `id: legacy_prompt
title: Legacy Prompt
version: 1.0.0
messages:
  - role: user
    content: Hello from legacy format
`,
      },
    ],
  });

  try {
    const run = await runDoctorCommand(["--cwd", cwd, "--format", "json"]);
    assert.equal(run.exitCode, 0);

    const json = JSON.parse(run.stdout) as {
      summary: { warnings: number };
      items: Array<{ status: string; message: string }>;
    };

    assert.ok(json.summary.warnings >= 1);
    assert.ok(
      json.items.some(
        (item) =>
          item.status === "warning" &&
          item.message === "legacy prompt format detected (transitional adapter in use)",
      ),
    );
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

