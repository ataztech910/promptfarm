import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  UnsupportedStudioPromptRuntimeRepositoryStrategyError,
  createStudioPromptRuntimeRepositoryForEnvironment,
} from "./studioPromptRuntimeRepository.js";

test("sqlite studio prompt runtime repository persists bundle by prompt id", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-studio-runtime-sqlite-"));
  const repository = createStudioPromptRuntimeRepositoryForEnvironment({
    cwd,
    env: {},
  });

  try {
    await repository.write("user_1", {
      version: 1,
      promptId: "book",
      latestScopeOutputs: {
        root: { kind: "generated_output", text: "Hello" },
      },
    });

    const persisted = await repository.read("user_1", "book");
    assert.equal(persisted?.promptId, "book");
    assert.equal(persisted?.version, 1);
    assert.deepEqual(persisted?.latestScopeOutputs, {
      root: { kind: "generated_output", text: "Hello" },
    });
  } finally {
    await repository.close?.();
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("file_json studio prompt runtime repository persists bundle in data directory", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-studio-runtime-file-"));
  const repository = createStudioPromptRuntimeRepositoryForEnvironment({
    cwd,
    dataDir: path.join(cwd, ".promptfarm-data"),
    provider: "file_json",
    env: {},
  });

  try {
    await repository.write("user_1", {
      version: 1,
      promptId: "story",
      summary: "Preview",
    });

    const persisted = await repository.read("user_1", "story");
    assert.equal(persisted?.promptId, "story");
    assert.equal(persisted?.summary, "Preview");
  } finally {
    await repository.close?.();
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("postgres studio prompt runtime repository strategy fails explicitly", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-studio-runtime-postgres-"));

  try {
    assert.throws(
      () =>
        createStudioPromptRuntimeRepositoryForEnvironment({
          cwd,
          provider: "postgres",
          databaseConfig: {
            provider: "postgres",
            connectionString: "postgresql://promptfarm:test@localhost/promptfarm",
          },
        }),
      UnsupportedStudioPromptRuntimeRepositoryStrategyError,
    );
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
