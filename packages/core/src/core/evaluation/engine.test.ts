import assert from "node:assert/strict";
import test from "node:test";
import { PromptSchema, ResolvedPromptArtifactSchema, type QualityGate } from "../../domain/index.js";
import { evaluateResolvedPrompt } from "./engine.js";

function buildPrompt(qualityGates: QualityGate[]) {
  return PromptSchema.parse({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: {
      id: "evaluation_target",
      version: "1.0.0",
      title: "Evaluation target",
      tags: ["quality"],
    },
    spec: {
      artifact: { type: "instruction" },
      inputs: [{ name: "system_name", type: "string", required: true }],
      messages: [{ role: "user", content: "Review {{system_name}}." }],
      use: [],
      evaluation: {
        reviewerRoles: [{ id: "manager" }, { id: "senior_engineer" }, { id: "consultant" }],
        rubric: {
          criteria: [
            { id: "correctness", title: "Correctness", weight: 2, maxScore: 5 },
            { id: "actionability", title: "Actionability", weight: 1, maxScore: 5 },
          ],
        },
        qualityGates,
      },
      buildTargets: [],
    },
  });
}

function buildArtifact() {
  return ResolvedPromptArtifactSchema.parse({
    promptId: "evaluation_target",
    artifactType: "instruction",
    dependencyOrder: ["base", "evaluation_target"],
    dependencyGraph: {
      nodes: [
        { id: "base", dependencies: [] },
        { id: "evaluation_target", dependencies: ["base"] },
      ],
    },
    inputs: [{ name: "system_name", type: "string", required: true }],
    messages: [
      { role: "system", content: "Base evaluation guidance." },
      { role: "user", content: "Review {{system_name}}." },
    ],
  });
}

test("evaluateResolvedPrompt is deterministic for same inputs", () => {
  const prompt = buildPrompt([]);
  const artifact = buildArtifact();

  const first = evaluateResolvedPrompt({ sourcePrompt: prompt, artifact });
  const second = evaluateResolvedPrompt({ sourcePrompt: prompt, artifact });

  assert.deepEqual(first, second);
});

test("quality gates evaluate overall/criterion thresholds", () => {
  const prompt = buildPrompt([
    { metric: "overall", operator: ">=", threshold: 0 },
    { metric: "criterion", criterionId: "correctness", operator: ">=", threshold: 999 },
  ]);
  const artifact = buildArtifact();

  const report = evaluateResolvedPrompt({ sourcePrompt: prompt, artifact });

  assert.equal(report.aggregated.gateResults.length, 2);
  assert.equal(report.aggregated.gateResults[0]?.passed, true);
  assert.equal(report.aggregated.gateResults[1]?.passed, false);
  assert.equal(report.aggregated.verdict, "fail");
});

test("reviewer verdict quality gate is supported", () => {
  const basePrompt = buildPrompt([]);
  const artifact = buildArtifact();
  const baseReport = evaluateResolvedPrompt({ sourcePrompt: basePrompt, artifact });
  const managerVerdict = baseReport.aggregated.reviewerVerdicts.manager;
  if (!managerVerdict) {
    throw new Error("manager verdict is missing");
  }

  const gatedPrompt = buildPrompt([
    {
      metric: "reviewer_verdict",
      reviewerId: "manager",
      requiredVerdict: managerVerdict,
    },
  ]);

  const report = evaluateResolvedPrompt({ sourcePrompt: gatedPrompt, artifact });
  const gate = report.aggregated.gateResults[0];

  assert.ok(gate);
  assert.equal(gate.passed, true);
  assert.equal(gate.actual, managerVerdict);
  assert.equal(report.aggregated.verdict, "pass");
});
