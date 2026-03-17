import assert from "node:assert/strict";
import test from "node:test";
import { PromptSchema } from "@promptfarm/core";
import { canonicalPromptToStructureGraph } from "./canonicalToStructureGraph";
import { buildProposalPreviewGraph } from "./proposalPreviewGraph";

const STRUCTURE_PROMPT_FIXTURE = PromptSchema.parse({
  apiVersion: "promptfarm/v1",
  kind: "Prompt",
  metadata: {
    id: "book_structure",
    version: "1.0.0",
    title: "Book Structure",
  },
  spec: {
    artifact: {
      type: "book_text",
    },
    use: [
      {
        prompt: "base-style",
        mode: "inline",
      },
    ],
    messages: [
      {
        role: "system",
        content: "Write a structured book.",
      },
    ],
    buildTargets: [
      {
        id: "markdown",
        format: "md",
        outputPath: "dist/book.md",
      },
    ],
    blocks: [
      {
        id: "chapter_1",
        kind: "chapter",
        title: "Chapter 1",
        messages: [
          {
            role: "user",
            content: "Draft chapter one.",
          },
        ],
        children: [
          {
            id: "section_1_1",
            kind: "section",
            title: "Section 1.1",
            messages: [
              {
                role: "user",
                content: "Write section 1.1.",
              },
            ],
            children: [
              {
                id: "block_1_1_1",
                kind: "generic_block",
                title: "Example",
                messages: [
                  {
                    role: "user",
                    content: "Add an example block.",
                  },
                ],
              },
            ],
          },
          {
            id: "section_1_2",
            kind: "section",
            title: "Section 1.2",
            messages: [
              {
                role: "user",
                content: "Write section 1.2.",
              },
            ],
          },
        ],
      },
      {
        id: "chapter_2",
        kind: "chapter",
        title: "Chapter 2",
        messages: [
          {
            role: "user",
            content: "Draft chapter two.",
          },
        ],
      },
    ],
  },
});

test("canonicalPromptToStructureGraph renders full prompt hierarchy with prompt context node", () => {
  const graph = canonicalPromptToStructureGraph(STRUCTURE_PROMPT_FIXTURE);

  assert.deepEqual(
    graph.nodes.map((node) => node.id).sort(),
    [
      "block:block_1_1_1",
      "block:chapter_1",
      "block:chapter_2",
      "block:section_1_1",
      "block:section_1_2",
      "prompt:book_structure",
      "use_prompt:base-style",
    ],
  );

  assert.deepEqual(
    graph.edges.map((edge) => `${edge.source}->${edge.target}`).sort(),
    [
      "block:chapter_1->block:section_1_1",
      "block:chapter_1->block:section_1_2",
      "block:section_1_1->block:block_1_1_1",
      "prompt:book_structure->block:chapter_1",
      "prompt:book_structure->block:chapter_2",
      "use_prompt:base-style->prompt:book_structure",
    ],
  );

  const leafNode = graph.nodes.find((node) => node.id === "block:block_1_1_1");
  assert.equal(leafNode?.data.description, "generic_block • 0 children");
});

test("buildProposalPreviewGraph can limit preview nodes to the focused source node", () => {
  const baseGraph = canonicalPromptToStructureGraph(STRUCTURE_PROMPT_FIXTURE);
  const preview = buildProposalPreviewGraph({
    baseNodes: baseGraph.nodes,
    proposals: [
      {
        proposalId: "proposal_root",
        sourceNodeId: "prompt:book_structure",
        sourceRuntimeNodeId: "prompt_root_book_structure",
        scope: {
          scopeRef: "root:book_structure",
          mode: "root",
          label: "Book Structure",
        },
        executionId: "exec_root",
        status: "preview",
        summary: "Root proposal",
        createdAt: Date.now(),
        blocks: [
          {
            proposalNodeId: "proposal_root_0",
            parentProposalNodeId: null,
            kind: "chapter",
            title: "Root Chapter",
            description: "Root proposal block",
            instruction: "Draft root chapter",
            children: [],
          },
        ],
      },
      {
        proposalId: "proposal_block",
        sourceNodeId: "block:chapter_1",
        sourceRuntimeNodeId: "chapter_1",
        scope: {
          scopeRef: "block:chapter_1",
          mode: "block",
          blockId: "chapter_1",
          label: "Chapter 1",
        },
        executionId: "exec_block",
        status: "preview",
        summary: "Block proposal",
        createdAt: Date.now(),
        blocks: [
          {
            proposalNodeId: "proposal_block_0",
            parentProposalNodeId: null,
            kind: "section",
            title: "Focused Section",
            description: "Block proposal section",
            instruction: "Draft focused section",
            children: [],
          },
        ],
      },
    ],
    visibleSourceNodeIds: ["block:chapter_1"],
  });

  assert.deepEqual(
    preview.nodes.map((node) => node.id),
    ["proposal:proposal_block_0"],
  );
  assert.deepEqual(
    preview.edges.map((edge) => `${edge.source}->${edge.target}`),
    ["block:chapter_1->proposal:proposal_block_0"],
  );
});
