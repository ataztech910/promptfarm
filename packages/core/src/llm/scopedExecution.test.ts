import assert from "node:assert/strict";
import test from "node:test";
import { ArtifactType, type Prompt } from "../domain/index.js";
import { buildScopedLlmPrompt, executeScopedLlmPrompt } from "./scopedExecution.js";

const fixturePrompt: Prompt = {
  apiVersion: "promptfarm/v1",
  kind: "Prompt",
  metadata: {
    id: "llm_scope_prompt",
    version: "1.0.0",
    title: "LLM Scope Prompt",
    tags: [],
  },
  spec: {
    artifact: { type: ArtifactType.Instruction },
    inputs: [{ name: "topic", type: "string", required: true }],
    messages: [{ role: "system", content: "You are writing about {{topic}}." }],
    use: [],
    buildTargets: [],
    blocks: [
      {
        id: "phase_1",
        kind: "phase",
        title: "Phase 1",
        inputs: [],
        messages: [{ role: "user", content: "Explain the plan for {{topic}}." }],
        children: [],
      },
    ],
  },
};

test("buildScopedLlmPrompt renders inherited scoped messages and upstream outputs", () => {
  const prompt = buildScopedLlmPrompt({
    prompt: fixturePrompt,
    scope: { mode: "block", blockId: "phase_1" },
    vars: { topic: "pipelines" },
    upstreamOutputs: ["Existing summary"],
  });

  assert.equal(prompt.messages[0]?.content, "You are writing about pipelines.");
  assert.equal(prompt.messages[1]?.content, "Explain the plan for pipelines.");
  assert.match(prompt.messages[2]?.content ?? "", /Existing summary/);
  assert.equal(prompt.upstreamOutputCount, 1);
});

test("buildScopedLlmPrompt appends a fallback user message when none exists", () => {
  const prompt = buildScopedLlmPrompt({
    prompt: fixturePrompt,
    scope: { mode: "root" },
    vars: { topic: "pipelines" },
  });

  assert.equal(prompt.messages[0]?.role, "system");
  assert.equal(prompt.messages[0]?.content, "You are writing about pipelines.");
  assert.equal(prompt.messages[1]?.role, "user");
  assert.match(prompt.messages[1]?.content ?? "", /Produce the best possible response/);
});

test("executeScopedLlmPrompt passes rendered messages into the llm client", async () => {
  let capturedMessages: { role: string; content: string }[] = [];

  const result = await executeScopedLlmPrompt({
    prompt: fixturePrompt,
    scope: { mode: "block", blockId: "phase_1" },
    vars: { topic: "graphs" },
    client: {
      async generateText(input) {
        capturedMessages = input.messages;
        return {
          outputText: "Generated plan",
          provider: "mock",
          model: "mock-model",
          generatedAt: new Date("2026-03-15T10:00:00.000Z"),
          executionTimeMs: 12,
        };
      },
    },
  });

  assert.equal(capturedMessages[0]?.content, "You are writing about graphs.");
  assert.equal(capturedMessages[1]?.content, "Explain the plan for graphs.");
  assert.equal(result.outputText, "Generated plan");
  assert.equal(result.provider, "mock");
  assert.equal(result.model, "mock-model");
});
