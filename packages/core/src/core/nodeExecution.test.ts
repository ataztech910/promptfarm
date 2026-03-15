import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelNodeExecutionRecord,
  completeNodeExecutionRecord,
  createNodeExecutionRecord,
  createNodeDependencyGraph,
  requestNodeExecutionCancellation,
  runNode,
  updateNodeRuntimeState,
  markStaleIfUpstreamChanged,
  assembleFinalOutput,
  extractScopedPrompt,
} from "./nodeExecution.js";
import { ArtifactType, type NodeExecutionResult, type NodeRuntimeState, type Prompt } from "../domain/index.js";

const mockPrompt: Prompt = {
  apiVersion: "promptfarm/v1",
  kind: "Prompt",
  metadata: {
    id: "test-prompt",
    version: "1.0.0",
    title: "Test Prompt",
    tags: [],
  },
  spec: {
    artifact: { type: ArtifactType.Instruction },
    inputs: [],
    messages: [{ role: "system", content: "Root system message" }],
    use: [],
    evaluation: undefined,
    buildTargets: [],
    blocks: [
      {
        id: "block1",
        kind: "phase",
        title: "Phase 1",
        inputs: [],
        messages: [{ role: "user", content: "Block 1 message" }],
        children: [
          {
            id: "block2",
            kind: "step_group",
            title: "Step Group",
            inputs: [],
            messages: [{ role: "assistant", content: "Block 2 message" }],
            children: [],
          },
        ],
      },
    ],
  },
};

test("extractScopedPrompt should extract scoped prompt for a block", () => {
  const scoped = extractScopedPrompt("block2", mockPrompt);
  assert(scoped !== null);
  assert.equal(scoped!.messages.length, 3); // root + block1 + block2
});

test("extractScopedPrompt should return null for non-existent block", () => {
  const scoped = extractScopedPrompt("nonexistent", mockPrompt);
  assert.equal(scoped, null);
});

test("runNode should run a node and return result", () => {
  const result = runNode("block2", mockPrompt);
  assert.equal(result.nodeId, "block2");
  assert.equal(result.status, "success");
  assert(result.output.includes("Block 2 message"));
  assert(result.output.includes("Root system message"));
});

test("runNode should handle non-existent node", () => {
  const result = runNode("nonexistent", mockPrompt);
  assert.equal(result.status, "error");
});

test("updateNodeRuntimeState should update state on success", () => {
  const states: NodeRuntimeState[] = [
    { nodeId: "block1", status: "idle", enabled: true },
  ];
  const result: NodeExecutionResult = {
    nodeId: "block1",
    output: "test output",
    status: "success",
    executedAt: new Date(),
  };
  const updated = updateNodeRuntimeState(states, result);
  assert.equal(updated[0]?.status, "success");
  assert.equal(updated[0]?.output, "test output");
});

test("markStaleIfUpstreamChanged should mark downstream as stale", () => {
  const states: NodeRuntimeState[] = [
    { nodeId: "block1", status: "success", enabled: true },
    { nodeId: "block2", status: "success", enabled: true },
  ];
  const updated = markStaleIfUpstreamChanged(states, ["block1"], createNodeDependencyGraph(mockPrompt));
  assert.equal(updated[1]?.status, "stale");
});

test("assembleFinalOutput should assemble output from enabled nodes", () => {
  const states: NodeRuntimeState[] = [
    { nodeId: "block1", status: "success", enabled: true, output: "Output 1" },
    { nodeId: "block2", status: "success", enabled: false, output: "Output 2" },
    { nodeId: "block3", status: "success", enabled: true, output: "Output 3" },
  ];
  const assembled = assembleFinalOutput(states);
  assert.equal(assembled, "Output 1\n\nOutput 3");
});

test("execution records track cancel requests and completion separately", () => {
  const startedAt = new Date("2026-03-15T10:00:00.000Z");
  const cancelRequestedAt = new Date("2026-03-15T10:00:01.000Z");
  const completedAt = new Date("2026-03-15T10:00:02.000Z");
  const record = createNodeExecutionRecord({
    executionId: "node_exec_1",
    promptId: "test_prompt",
    nodeId: "block1",
    scope: { mode: "block", blockId: "block1" },
    sourceSnapshotHash: "snapshot",
    startedAt,
  });

  const cancelRequested = requestNodeExecutionCancellation(record, cancelRequestedAt);
  const cancelled = cancelNodeExecutionRecord(cancelRequested, completedAt);
  const completed = completeNodeExecutionRecord(record, { status: "success", output: "done" }, completedAt);

  assert.equal(cancelRequested.status, "cancel_requested");
  assert.equal(cancelRequested.cancelRequestedAt, cancelRequestedAt);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.completedAt, completedAt);
  assert.equal(completed.status, "success");
  assert.equal(completed.output, "done");
});
