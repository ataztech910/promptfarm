import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryNodeExecutionRepository } from "./nodeExecutionRepository.js";

test("in-memory execution repository is prompt-aware and prunes by prompt scope", () => {
  const repository = createInMemoryNodeExecutionRepository();

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
  });
  repository.put({
    executionId: "node_exec_2",
    promptId: "prompt_b",
    nodeId: "block_1",
    scope: { mode: "block", blockId: "block_1" },
    status: "running",
    sourceSnapshotHash: "snap_b",
    startedAt: new Date("2026-03-15T10:01:00.000Z"),
  });

  assert.equal(repository.listByPrompt("prompt_a").length, 1);
  assert.equal(repository.listByPrompt("prompt_b").length, 1);
  assert.equal(repository.listActive("prompt_b").length, 1);

  repository.pruneToPrompt("prompt_a", ["prompt_root_prompt_a"]);

  assert.equal(repository.listByPrompt("prompt_a").length, 0);
  assert.equal(repository.listByPrompt("prompt_b").length, 1);
});
