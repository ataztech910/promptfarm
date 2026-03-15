import assert from "node:assert/strict";
import test from "node:test";
import { PromptSchema } from "@promptfarm/core";
import { canonicalPromptToStructureGraph } from "./canonicalToStructureGraph";

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
