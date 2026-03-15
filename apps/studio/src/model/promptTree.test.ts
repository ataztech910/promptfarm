import assert from "node:assert/strict";
import test from "node:test";
import { PromptSchema } from "@promptfarm/core";
import { describeTreeEmptyState, getPromptBlockPath, getSiblingBlockKinds, getSuggestedBlockKinds } from "./promptTree";

const TREE_PROMPT = PromptSchema.parse({
  apiVersion: "promptfarm/v1",
  kind: "Prompt",
  metadata: {
    id: "tree_model",
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
        ],
      },
    ],
  },
});

test("getSuggestedBlockKinds is artifact-aware and tree-aware", () => {
  assert.deepEqual(getSuggestedBlockKinds(TREE_PROMPT, null), ["chapter"]);
  assert.deepEqual(getSuggestedBlockKinds(TREE_PROMPT, "chapter_1"), ["section"]);
  assert.deepEqual(getSuggestedBlockKinds(TREE_PROMPT, "section_1"), ["generic_block"]);
  assert.deepEqual(getSuggestedBlockKinds(TREE_PROMPT, "generic_block_missing"), []);
});

test("getSiblingBlockKinds follows parent semantics", () => {
  assert.deepEqual(getSiblingBlockKinds(TREE_PROMPT, "section_1"), ["section"]);
});

test("book_text hierarchy allows recursive generic blocks", () => {
  const prompt = PromptSchema.parse({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: {
      id: "tree_model_generic",
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
                  title: "Leaf",
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

  assert.deepEqual(getSuggestedBlockKinds(prompt, "generic_block_1"), ["generic_block"]);
});

test("getPromptBlockPath returns hierarchical path", () => {
  assert.deepEqual(
    getPromptBlockPath(TREE_PROMPT.spec.blocks, "section_1").map((block) => block.id),
    ["chapter_1", "section_1"],
  );
});

test("describeTreeEmptyState explains structured authoring by artifact type", () => {
  assert.match(describeTreeEmptyState(TREE_PROMPT), /chapter/i);
});
