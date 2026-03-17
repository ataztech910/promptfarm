import assert from "node:assert/strict";
import test from "node:test";
import { PromptSchema, type Prompt } from "@promptfarm/core";
import { canonicalPromptToGraph } from "./canonicalToGraph";
import { applyGraphIntentToPrompt } from "./graphSync";

function rootPromptSelectionId(prompt: Prompt): string {
  return `prompt:${prompt.metadata.id}`;
}

function createPromptFixture(): Prompt {
  return PromptSchema.parse({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: {
      id: "architecture_review",
      version: "1.0.0",
      title: "Architecture Review",
      description: "Review a target architecture",
      tags: ["engineering", "architecture"],
    },
    spec: {
      artifact: {
        type: "instruction",
      },
      inputs: [
        {
          name: "system_name",
          type: "string",
          required: true,
          description: "Target system name",
          default: "PromptFarm",
        },
      ],
      messages: [
        {
          role: "system",
          content: "You are a senior architect.",
        },
        {
          role: "user",
          content: "Review architecture.",
        },
      ],
      use: [
        {
          prompt: "base",
          mode: "inline",
          version: "1.0.0",
          with: {
            locale: "en-US",
          },
        },
      ],
      evaluation: {
        reviewerRoles: [
          { id: "manager" },
          { id: "senior_engineer" },
        ],
        rubric: {
          criteria: [
            {
              id: "correctness",
              title: "Correctness",
              weight: 1,
              maxScore: 5,
            },
          ],
        },
        qualityGates: [
          {
            metric: "overall",
            operator: ">=",
            threshold: 0,
          },
        ],
      },
      buildTargets: [
        {
          id: "markdown",
          format: "md",
          outputPath: "dist/architecture_review.md",
          options: {
            lineWidth: 80,
          },
        },
      ],
    },
  });
}

test("applyGraphIntentToPrompt patches prompt-owned messages and inputs through synthetic root prompt selection", () => {
  const prompt = createPromptFixture();
  const graph = canonicalPromptToGraph(prompt);

  const result = applyGraphIntentToPrompt(prompt, graph, {
    type: "node.patch",
    nodeId: rootPromptSelectionId(prompt),
    changes: {
      messages: [
        {
          role: "system",
          content: "Updated system guidance.",
        },
      ],
      inputs: [
        {
          name: "project_name",
          type: "string",
          required: false,
          description: "Project under review",
          default: { stack: "ts" },
        },
      ],
    },
  });

  assert.equal(result.supported, true);
  if (!result.supported) return;

  assert.equal(result.prompt.spec.inputs[0]?.name, "project_name");
  assert.equal(result.prompt.spec.inputs[0]?.required, false);
  assert.equal(result.prompt.spec.inputs[0]?.description, "Project under review");
  assert.deepEqual(result.prompt.spec.inputs[0]?.default, { stack: "ts" });
  assert.equal(result.prompt.spec.messages[0]?.content, "Updated system guidance.");
});

test("canonicalPromptToGraph keeps only structural nodes on the graph", () => {
  const prompt = createPromptFixture();
  const graph = canonicalPromptToGraph(prompt);
  assert.equal(graph.nodes.some((node) => node.data.kind === "prompt"), true);
  assert.equal(graph.nodes.some((node) => node.data.kind === "use_prompt"), true);
  assert.equal(graph.nodes.some((node) => node.data.kind === "artifact"), false);
  assert.equal(graph.nodes.some((node) => node.data.kind === "message"), false);
  assert.equal(graph.nodes.some((node) => node.data.kind === "input"), false);
  assert.equal(graph.nodes.some((node) => node.data.kind === "evaluation"), false);
  assert.equal(graph.nodes.some((node) => node.id.startsWith("build:")), false);
  assert.equal(graph.edges.length > 0, true);
});

test("synthetic root prompt patch updates artifact type and primary build target while preserving advanced fields", () => {
  const prompt = createPromptFixture();
  prompt.spec.buildTargets.push({
    id: "html",
    format: "html",
    outputPath: "dist/architecture_review.html",
    options: {
      minify: true,
    },
  });

  const graph = canonicalPromptToGraph(prompt);

  const result = applyGraphIntentToPrompt(prompt, graph, {
    type: "node.patch",
    nodeId: rootPromptSelectionId(prompt),
    changes: {
      artifactType: "course",
      buildTarget: "json",
    },
  });

  assert.equal(result.supported, true);
  if (!result.supported) return;

  assert.equal(result.prompt.spec.artifact.type, "course");
  assert.equal(result.prompt.spec.buildTargets[0]?.id, "json");
  assert.equal(result.prompt.spec.buildTargets[0]?.format, "json");
  assert.deepEqual(result.prompt.spec.buildTargets[0]?.options, { lineWidth: 80 });
  assert.equal(result.prompt.spec.buildTargets[1]?.id, "html");
  assert.deepEqual(result.prompt.spec.buildTargets[1]?.options, { minify: true });
});

test("applyGraphIntentToPrompt preserves unsupported fields", () => {
  const prompt = createPromptFixture();
  const graph = canonicalPromptToGraph(prompt);

  const result = applyGraphIntentToPrompt(prompt, graph, {
    type: "node.patch",
    nodeId: rootPromptSelectionId(prompt),
    changes: {
      messages: [
        {
          role: "system",
          content: "Updated message body.",
        },
      ],
    },
  });

  assert.equal(result.supported, true);
  if (!result.supported) return;

  assert.deepEqual(result.prompt.spec.use[0]?.with, { locale: "en-US" });
  assert.deepEqual(result.prompt.spec.buildTargets[0]?.options, { lineWidth: 80 });
  assert.deepEqual(result.prompt.spec.evaluation, prompt.spec.evaluation);
});

test("synthetic root prompt patch can add evaluation spec", () => {
  const prompt = createPromptFixture();
  delete prompt.spec.evaluation;
  const graph = canonicalPromptToGraph(prompt);

  const result = applyGraphIntentToPrompt(prompt, graph, {
    type: "node.patch",
    nodeId: rootPromptSelectionId(prompt),
    changes: {
      evaluation: {
        reviewerRoles: [{ id: "manager" }],
        rubric: {
          criteria: [
            {
              id: "correctness",
              title: "Correctness",
              weight: 1,
              maxScore: 5,
            },
          ],
        },
        qualityGates: [
          {
            metric: "overall",
            operator: ">=",
            threshold: 0,
          },
        ],
      },
    },
  });

  assert.equal(result.supported, true);
  if (!result.supported) return;

  assert.equal(result.prompt.spec.evaluation?.reviewerRoles[0]?.id, "manager");
  assert.equal(result.prompt.spec.evaluation?.rubric.criteria[0]?.id, "correctness");
});

test("applyGraphIntentToPrompt rejects invalid patch and keeps source prompt unchanged", () => {
  const prompt = createPromptFixture();
  const graph = canonicalPromptToGraph(prompt);

  const result = applyGraphIntentToPrompt(prompt, graph, {
    type: "node.patch",
    nodeId: rootPromptSelectionId(prompt),
    changes: {
      artifactType: "invalid_artifact_type",
    },
  });

  assert.equal(result.supported, false);
  if (result.supported) return;
  assert.ok(result.issues.length > 0);
  assert.equal(prompt.spec.artifact.type, "instruction");
});

test("canonical graph regeneration remains stable after successful patch", () => {
  const prompt = createPromptFixture();
  const graph = canonicalPromptToGraph(prompt);

  const result = applyGraphIntentToPrompt(prompt, graph, {
    type: "node.patch",
    nodeId: rootPromptSelectionId(prompt),
    changes: {
      title: "Architecture Review Updated",
      tags: "engineering, review",
    },
  });

  assert.equal(result.supported, true);
  if (!result.supported) return;

  const graphA = canonicalPromptToGraph(result.prompt);
  const graphB = canonicalPromptToGraph(result.prompt);
  assert.deepEqual(graphA, graphB);
});

test("applyGraphIntentToPrompt can reparent a block into another block", () => {
  const prompt = PromptSchema.parse({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: {
      id: "tree_reparent",
      version: "1.0.0",
    },
    spec: {
      artifact: {
        type: "book_text",
      },
      messages: [{ role: "system", content: "Root" }],
      use: [],
      buildTargets: [],
      blocks: [
        {
          id: "chapter_1",
          kind: "chapter",
          title: "Chapter 1",
          messages: [],
          children: [
            {
              id: "section_1",
              kind: "section",
              title: "Section 1",
              messages: [],
              children: [
                {
                  id: "generic_block_1",
                  kind: "generic_block",
                  title: "Leaf 1",
                  messages: [],
                  children: [],
                },
                {
                  id: "generic_block_2",
                  kind: "generic_block",
                  title: "Leaf 2",
                  messages: [],
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
  });
  const graph = canonicalPromptToGraph(prompt);

  const result = applyGraphIntentToPrompt(prompt, graph, {
    type: "block.reparent",
    blockId: "generic_block_1",
    targetBlockId: "generic_block_2",
  });

  assert.equal(result.supported, true);
  if (!result.supported) return;

  const parent = result.prompt.spec.blocks[0]?.children[0];
  assert.deepEqual(parent?.children.map((block) => block.id), ["generic_block_2"]);
  assert.deepEqual(parent?.children[0]?.children.map((block) => block.id), ["generic_block_1"]);
});

test("applyGraphIntentToPrompt can relocate a block within the same branch", () => {
  const prompt = PromptSchema.parse({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: {
      id: "tree_relocate",
      version: "1.0.0",
    },
    spec: {
      artifact: {
        type: "book_text",
      },
      messages: [{ role: "system", content: "Root" }],
      use: [],
      buildTargets: [],
      blocks: [
        {
          id: "chapter_1",
          kind: "chapter",
          title: "Chapter 1",
          messages: [],
          children: [
            {
              id: "section_1",
              kind: "section",
              title: "Section 1",
              messages: [],
              children: [],
            },
            {
              id: "section_2",
              kind: "section",
              title: "Section 2",
              messages: [],
              children: [],
            },
          ],
        },
      ],
    },
  });
  const graph = canonicalPromptToGraph(prompt);

  const result = applyGraphIntentToPrompt(prompt, graph, {
    type: "block.relocate",
    blockId: "section_2",
    targetParentId: "chapter_1",
    targetIndex: 0,
  });

  assert.equal(result.supported, true);
  if (!result.supported) return;

  assert.deepEqual(result.prompt.spec.blocks[0]?.children.map((block) => block.id), ["section_2", "section_1"]);
});

test("applyGraphIntentToPrompt can relocate a block into another parent at a child index", () => {
  const prompt = PromptSchema.parse({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: {
      id: "tree_relocate_nested",
      version: "1.0.0",
    },
    spec: {
      artifact: {
        type: "code",
      },
      messages: [{ role: "system", content: "Root" }],
      use: [],
      buildTargets: [],
      blocks: [
        {
          id: "generic_block_1",
          kind: "generic_block",
          title: "Block 1",
          messages: [],
          children: [
            {
              id: "child_1",
              kind: "generic_block",
              title: "Child 1",
              messages: [],
              children: [],
            },
            {
              id: "child_2",
              kind: "generic_block",
              title: "Child 2",
              messages: [],
              children: [],
            },
          ],
        },
        {
          id: "generic_block_2",
          kind: "generic_block",
          title: "Block 2",
          messages: [],
          children: [],
        },
      ],
    },
  });
  const graph = canonicalPromptToGraph(prompt);

  const result = applyGraphIntentToPrompt(prompt, graph, {
    type: "block.relocate",
    blockId: "generic_block_2",
    targetParentId: "generic_block_1",
    targetIndex: 1,
  });

  assert.equal(result.supported, true);
  if (!result.supported) return;

  assert.deepEqual(result.prompt.spec.blocks.map((block) => block.id), ["generic_block_1"]);
  assert.deepEqual(result.prompt.spec.blocks[0]?.children.map((block) => block.id), ["child_1", "generic_block_2", "child_2"]);
});
