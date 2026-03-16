import assert from "node:assert/strict";
import test from "node:test";
import { ArtifactType } from "@promptfarm/core";
import { createStarterPrompt, deriveFlowGuideSteps, deriveStageBarStages } from "./goldenPath";

test("createStarterPrompt generates canonical starter pipeline", () => {
  const prompt = createStarterPrompt(ArtifactType.Instruction);

  assert.equal(prompt.spec.artifact.type, ArtifactType.Instruction);
  assert.equal(prompt.spec.messages.length, 1);
  assert.equal(prompt.spec.messages[0]?.role, "system");
  assert.equal(prompt.spec.buildTargets.length, 1);
  assert.equal(prompt.spec.inputs.length, 0);
});

test("createStarterPrompt generates unique ids for the same artifact type", () => {
  const first = createStarterPrompt(ArtifactType.BookText);
  const second = createStarterPrompt(ArtifactType.BookText);

  assert.notEqual(first.metadata.id, second.metadata.id);
  assert.match(first.metadata.id, /^new_book_text_prompt_[a-z0-9]+_[a-z0-9]+$/);
  assert.match(second.metadata.id, /^new_book_text_prompt_[a-z0-9]+_[a-z0-9]+$/);
});

test("flow guide derives completion from canonical prompt and runtime preview", () => {
  const prompt = createStarterPrompt(ArtifactType.Code);
  const steps = deriveFlowGuideSteps({
    prompt,
    runtimePreview: {
      context: {
        resolvedArtifact: {} as never,
      } as never,
      issues: [],
      blueprint: {} as never,
    },
    lastRuntimeAction: "blueprint",
  });

  assert.equal(steps.find((step) => step.id === "prompt")?.completed, true);
  assert.equal(steps.find((step) => step.id === "message")?.completed, true);
  assert.equal(steps.find((step) => step.id === "input")?.completed, false);
  assert.equal(steps.find((step) => step.id === "resolve")?.completed, true);
  assert.equal(steps.find((step) => step.id === "blueprint")?.completed, true);
  assert.equal(steps.find((step) => step.id === "build")?.completed, false);
});

test("stage bar gating follows golden path sequence", () => {
  const prompt = createStarterPrompt(ArtifactType.Course);
  const stagesBeforeResolve = deriveStageBarStages({
    prompt,
    runtimePreview: { issues: [] },
    executionStatus: "idle",
    lastRuntimeAction: undefined,
  });

  assert.equal(stagesBeforeResolve.find((stage) => stage.id === "resolve")?.enabled, true);
  assert.equal(stagesBeforeResolve.find((stage) => stage.id === "evaluate")?.enabled, false);
  assert.equal(stagesBeforeResolve.find((stage) => stage.id === "blueprint")?.enabled, false);
  assert.equal(stagesBeforeResolve.find((stage) => stage.id === "build")?.enabled, false);

  const stagesAfterBlueprint = deriveStageBarStages({
    prompt,
    runtimePreview: {
      context: {
        resolvedArtifact: {} as never,
      } as never,
      issues: [],
      blueprint: {} as never,
    },
    executionStatus: "success",
    lastRuntimeAction: "blueprint",
  });

  assert.equal(stagesAfterBlueprint.find((stage) => stage.id === "build")?.enabled, true);
});
