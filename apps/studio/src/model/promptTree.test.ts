import assert from "node:assert/strict";
import test from "node:test";
import { PromptSchema } from "@promptfarm/core";
import { describeTreeEmptyState, getPromptBlockPath, getSiblingBlockKinds, getSuggestedBlockKinds, relocatePromptBlock, reparentPromptBlock } from "./promptTree";

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

test("reparentPromptBlock moves a block into a new parent", () => {
  const prompt = PromptSchema.parse(TREE_PROMPT);
  prompt.spec.blocks[0]?.children[0]?.children.push(
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
  );

  const moved = reparentPromptBlock(prompt, "generic_block_1", "generic_block_2");

  assert.equal(moved, true);
  assert.deepEqual(prompt.spec.blocks[0]?.children[0]?.children.map((block) => block.id), ["generic_block_2"]);
  assert.deepEqual(prompt.spec.blocks[0]?.children[0]?.children[0]?.children.map((block) => block.id), ["generic_block_1"]);
});

test("reparentPromptBlock rejects moving a block into its own descendant", () => {
  const prompt = PromptSchema.parse(TREE_PROMPT);

  const moved = reparentPromptBlock(prompt, "chapter_1", "section_1");

  assert.equal(moved, false);
  assert.deepEqual(prompt.spec.blocks.map((block) => block.id), ["chapter_1"]);
  assert.deepEqual(prompt.spec.blocks[0]?.children.map((block) => block.id), ["section_1"]);
});

test("relocatePromptBlock reorders siblings within the same parent", () => {
  const prompt = PromptSchema.parse(TREE_PROMPT);
  prompt.spec.blocks[0]?.children.push({
    id: "section_2",
    kind: "section",
    title: "Section 2",
    messages: [],
    children: [],
  });

  const moved = relocatePromptBlock(prompt, "section_2", "chapter_1", 0);

  assert.equal(moved, true);
  assert.deepEqual(prompt.spec.blocks[0]?.children.map((block) => block.id), ["section_2", "section_1"]);
});

test("relocatePromptBlock can move a sibling downward within the same parent", () => {
  const prompt = PromptSchema.parse(TREE_PROMPT);
  prompt.spec.blocks[0]?.children.push({
    id: "section_2",
    kind: "section",
    title: "Section 2",
    messages: [],
    children: [],
  });

  const moved = relocatePromptBlock(prompt, "section_1", "chapter_1", 1);

  assert.equal(moved, true);
  assert.deepEqual(prompt.spec.blocks[0]?.children.map((block) => block.id), ["section_2", "section_1"]);
});

test("relocatePromptBlock can insert a root block between child nodes of another parent when allowed", () => {
  const prompt = PromptSchema.parse({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: {
      id: "tree_model_generic_nested_relocate",
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

  const moved = relocatePromptBlock(prompt, "generic_block_2", "generic_block_1", 1);

  assert.equal(moved, true);
  assert.deepEqual(prompt.spec.blocks.map((block) => block.id), ["generic_block_1"]);
  assert.deepEqual(prompt.spec.blocks[0]?.children.map((block) => block.id), ["child_1", "generic_block_2", "child_2"]);
});
