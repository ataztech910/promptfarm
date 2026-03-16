import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createSqliteNodeExecutionRepository,
  resolvePromptFarmDatabaseConfig,
  SqliteNodeExecutionRepository,
} from "../node.js";

function createTempDbPath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "promptfarm-node-exec-"));
  return path.join(directory, "promptfarm.db");
}

test("sqlite execution repository persists records across repository instances", () => {
  const filename = createTempDbPath();
  const repository = createSqliteNodeExecutionRepository(filename) as SqliteNodeExecutionRepository;

  repository.put({
    executionId: "node_exec_1",
    promptId: "prompt_a",
    nodeId: "block_1",
    scope: { mode: "block", blockId: "block_1" },
    status: "success",
    sourceSnapshotHash: "snap_a",
    startedAt: new Date("2026-03-15T10:00:00.000Z"),
    completedAt: new Date("2026-03-15T10:00:01.000Z"),
    output: "A",
    provider: "ollama_openai",
    model: "llama3.2:latest",
    executionTimeMs: 101,
  });
  repository.close();

  const reopened = createSqliteNodeExecutionRepository(filename) as SqliteNodeExecutionRepository;
  const record = reopened.get("node_exec_1");

  assert.ok(record);
  assert.equal(record?.promptId, "prompt_a");
  assert.equal(record?.status, "success");
  assert.equal(record?.provider, "ollama_openai");
  assert.equal(record?.model, "llama3.2:latest");
  assert.equal(record?.executionTimeMs, 101);
  assert.ok(record?.startedAt instanceof Date);
  assert.ok(record?.completedAt instanceof Date);
  reopened.close();
});

test("sqlite execution repository supports durable cancel_requested and prompt pruning", () => {
  const filename = createTempDbPath();
  const repository = createSqliteNodeExecutionRepository(filename) as SqliteNodeExecutionRepository;

  repository.putMany([
    {
      executionId: "node_exec_1",
      promptId: "prompt_a",
      nodeId: "prompt_root_prompt_a",
      scope: { mode: "root" },
      status: "cancel_requested",
      sourceSnapshotHash: "snap_a",
      startedAt: new Date("2026-03-15T10:00:00.000Z"),
      cancelRequestedAt: new Date("2026-03-15T10:00:05.000Z"),
    },
    {
      executionId: "node_exec_2",
      promptId: "prompt_a",
      nodeId: "obsolete_block",
      scope: { mode: "block", blockId: "obsolete_block" },
      status: "success",
      sourceSnapshotHash: "snap_b",
      startedAt: new Date("2026-03-15T10:01:00.000Z"),
      completedAt: new Date("2026-03-15T10:01:10.000Z"),
      output: "obsolete",
    },
    {
      executionId: "node_exec_3",
      promptId: "prompt_b",
      nodeId: "block_1",
      scope: { mode: "block", blockId: "block_1" },
      status: "running",
      sourceSnapshotHash: "snap_c",
      startedAt: new Date("2026-03-15T10:02:00.000Z"),
    },
  ]);

  assert.equal(repository.listActive("prompt_a").length, 1);
  assert.equal(repository.listActive("prompt_b").length, 1);

  repository.pruneToPrompt("prompt_a", ["prompt_root_prompt_a"]);

  assert.equal(repository.listByPrompt("prompt_a").length, 1);
  assert.equal(repository.listByPrompt("prompt_a")[0]?.executionId, "node_exec_1");
  assert.ok(repository.get("node_exec_1")?.cancelRequestedAt instanceof Date);
  repository.close();
});

test("database config defaults to local sqlite and accepts postgres configuration", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "promptfarm-db-config-"));

  const sqliteConfig = resolvePromptFarmDatabaseConfig({
    env: {},
    cwd,
  });
  assert.equal(sqliteConfig.provider, "sqlite");
  assert.equal(sqliteConfig.filename, path.join(cwd, "promptfarm.db"));

  const postgresConfig = resolvePromptFarmDatabaseConfig({
    env: {
      DATABASE_URL: "postgresql://promptfarm:secret@localhost:5432/promptfarm",
    },
    cwd,
  });
  assert.equal(postgresConfig.provider, "postgres");
  assert.equal(postgresConfig.connectionString, "postgresql://promptfarm:secret@localhost:5432/promptfarm");
});
