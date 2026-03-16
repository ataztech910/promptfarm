import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  UnsupportedStudioRuntimeStoreStrategyError,
  createStudioPromptRuntimeStoreForEnvironment,
} from "./studioRuntimeStore.js";

test("sqlite studio runtime store persists bundle by prompt id", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-studio-runtime-sqlite-"));
  const store = createStudioPromptRuntimeStoreForEnvironment({
    cwd,
    env: {},
  });

  try {
    await store.write("user_1", {
      version: 1,
      promptId: "book",
      latestScopeOutputs: {
        root: { kind: "generated_output", text: "Hello" },
      },
    });

    const persisted = await store.read("user_1", "book");
    assert.equal(persisted?.promptId, "book");
    assert.equal(persisted?.version, 1);
    assert.deepEqual(persisted?.latestScopeOutputs, {
      root: { kind: "generated_output", text: "Hello" },
    });
  } finally {
    await store.close?.();
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("file_json studio runtime store persists bundle in data directory", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-studio-runtime-file-"));
  const store = createStudioPromptRuntimeStoreForEnvironment({
    cwd,
    dataDir: path.join(cwd, ".promptfarm-data"),
    provider: "file_json",
    env: {},
  });

  try {
    await store.write("user_1", {
      version: 1,
      promptId: "story",
      summary: "Preview",
    });

    const persisted = await store.read("user_1", "story");
    assert.equal(persisted?.promptId, "story");
    assert.equal(persisted?.summary, "Preview");
  } finally {
    await store.close?.();
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("postgres studio runtime store strategy fails explicitly", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-studio-runtime-postgres-"));

  try {
    assert.throws(
      () =>
        createStudioPromptRuntimeStoreForEnvironment({
          cwd,
          provider: "postgres",
          databaseConfig: {
            provider: "postgres",
            connectionString: "postgresql://promptfarm:test@localhost/promptfarm",
          },
        }),
      UnsupportedStudioRuntimeStoreStrategyError,
    );
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
