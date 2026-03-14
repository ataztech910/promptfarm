import assert from "node:assert/strict";
import test from "node:test";
import { PromptSchema, getAllowedPromptBlockKinds } from "../../domain/index.js";

test("shared block hierarchy rules are parent-kind aware for book_text", () => {
  assert.deepEqual(getAllowedPromptBlockKinds("book_text", null), ["chapter"]);
  assert.deepEqual(getAllowedPromptBlockKinds("book_text", "chapter"), ["section"]);
  assert.deepEqual(getAllowedPromptBlockKinds("book_text", "section"), ["generic_block"]);
  assert.deepEqual(getAllowedPromptBlockKinds("book_text", "generic_block"), ["generic_block"]);
});

test("shared block hierarchy rules allow recursive generic blocks across artifact types", () => {
  assert.deepEqual(getAllowedPromptBlockKinds("code", "generic_block"), ["generic_block"]);
  assert.deepEqual(getAllowedPromptBlockKinds("story", "generic_block"), ["generic_block"]);
  assert.deepEqual(getAllowedPromptBlockKinds("instruction", "generic_block"), ["generic_block"]);
  assert.deepEqual(getAllowedPromptBlockKinds("course", "generic_block"), ["generic_block"]);
});

test("PromptSchema rejects invalid nested block hierarchy", () => {
  const result = PromptSchema.safeParse({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: {
      id: "invalid_book_hierarchy",
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
              id: "bad_child",
              kind: "chapter",
              title: "Nested Chapter",
              messages: [],
              children: [],
            },
          ],
        },
      ],
    },
  });

  assert.equal(result.success, false);
  if (result.success) return;

  assert.match(result.error.issues[0]?.message ?? "", /not allowed under chapter/i);
});
