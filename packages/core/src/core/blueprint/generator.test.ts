import assert from "node:assert/strict";
import test from "node:test";
import {
  ArtifactBlueprintSchema,
  ArtifactType,
  PromptSchema,
  ResolvedPromptArtifactSchema,
} from "../../domain/index.js";
import { generateArtifactBlueprint } from "./generator.js";
import { createBlueprintExecutionContext } from "../runtimeBlueprint.js";
import type { ExecutionContext } from "../runtimePipeline.js";

function makeContext(artifactType: ArtifactType, withEvaluationSpec: boolean): ExecutionContext {
  const prompt = PromptSchema.parse({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: {
      id: "sample_prompt",
      version: "1.0.0",
      title: "Sample Prompt",
      tags: ["engineering"],
    },
    spec: {
      artifact: {
        type: artifactType,
      },
      inputs: [
        {
          name: "project_name",
          type: "string",
          required: true,
        },
      ],
      messages: [
        {
          role: "system",
          content: "Base guidance for generation.",
        },
        {
          role: "user",
          content: "Create deliverables for {{project_name}}.",
        },
      ],
      use: [],
      evaluation: withEvaluationSpec
        ? {
            reviewerRoles: [{ id: "manager" }],
            rubric: {
              criteria: [{ id: "clarity", title: "Clarity", maxScore: 5, weight: 1 }],
            },
            qualityGates: [{ metric: "overall", operator: ">=", threshold: 0 }],
          }
        : undefined,
      buildTargets: [],
    },
  });

  const resolved = ResolvedPromptArtifactSchema.parse({
    promptId: "sample_prompt",
    artifactType,
    dependencyOrder: ["sample_prompt"],
    dependencyGraph: {
      nodes: [{ id: "sample_prompt", dependencies: [] }],
    },
    inputs: prompt.spec.inputs,
    messages: prompt.spec.messages,
  });

  return {
    cwd: process.cwd(),
    promptId: "sample_prompt",
    sourcePrompt: prompt,
    sourceFilepath: "/tmp/sample_prompt.prompt.yaml",
    resolvedArtifact: resolved,
    resolvedPrompt: {
      id: "sample_prompt",
      title: "Sample Prompt",
      version: "1.0.0",
      use: [],
      tags: [],
      messages: prompt.spec.messages,
      inputs: {
        project_name: {
          type: "string",
          required: true,
        },
      },
    },
    diagnostics: [],
    metadata: {
      dependencyOrder: resolved.dependencyOrder,
      artifactType: resolved.artifactType,
    },
  };
}

test("generateArtifactBlueprint is deterministic and valid for all supported artifact types", () => {
  const types: ArtifactType[] = [
    ArtifactType.Code,
    ArtifactType.BookText,
    ArtifactType.Instruction,
    ArtifactType.Story,
    ArtifactType.Course,
  ];

  for (const type of types) {
    const context = makeContext(type, false);
    const first = generateArtifactBlueprint(context);
    const second = generateArtifactBlueprint(context);

    assert.deepEqual(first, second);
    const parsed = ArtifactBlueprintSchema.parse(first);
    assert.equal(parsed.artifactType, type);
  }
});

test("createBlueprintExecutionContext attaches evaluation summary when evaluation is configured", () => {
  const context = makeContext(ArtifactType.Instruction, true);
  const withBlueprint = createBlueprintExecutionContext(context, { evaluateIfConfigured: true });

  assert.ok(withBlueprint.evaluation);
  assert.ok(withBlueprint.blueprint);
  assert.ok(withBlueprint.blueprint?.evaluationSummary);
  assert.equal(withBlueprint.blueprint?.artifactType, ArtifactType.Instruction);
});
