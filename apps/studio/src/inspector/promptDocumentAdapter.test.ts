import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPromptDocumentEditorData,
  applyPromptWorkspaceBlocks,
  addPromptDocumentPresetBlock,
  compilePromptWorkspaceBlocks,
  createPromptDocumentEditorData,
  createPromptDocumentModel,
  createPromptWorkspaceBlocks,
  describePromptDocumentMessage,
  upsertPromptDocumentPrimary,
} from "./promptDocumentAdapter";
import type { BlockDraft } from "./editorSession";

function createDraft(): BlockDraft {
  return {
    entityKind: "block",
    blockId: "chapter_1",
    blockKind: "chapter",
    title: "Chapter",
    description: "",
    messages: [
      { role: "system", content: "Keep the writing practical." },
      { role: "user", content: "Explain why habits fail." },
      { role: "assistant", content: "Example output:\n..." },
    ],
    inputs: [],
  };
}

test("createPromptDocumentModel identifies primary, context, and extra message blocks", () => {
  const model = createPromptDocumentModel(createDraft());
  assert.equal(model.primaryInstructionIndex, 1);
  assert.equal(model.contextMessageIndex, 0);
  assert.deepEqual(model.additionalMessageIndexes, [2]);
  assert.deepEqual(
    model.additionalBlocks.map((block) => block.kind),
    ["example_output"],
  );
});

test("upsertPromptDocumentPrimary updates existing instruction and context blocks", () => {
  const draft = createDraft();
  const nextInstruction = upsertPromptDocumentPrimary(draft, "instruction", "Draft a clearer chapter opening.");
  const nextContext = upsertPromptDocumentPrimary(draft, "context", "Use a practical non-fiction tone.");

  assert.equal(nextInstruction.messages[1]?.content, "Draft a clearer chapter opening.");
  assert.equal(nextInstruction.messages[1]?.role, "user");
  assert.equal(nextContext.messages[0]?.content, "Use a practical non-fiction tone.");
  assert.equal(nextContext.messages[0]?.role, "system");
});

test("upsertPromptDocumentPrimary creates missing instruction and context blocks when absent", () => {
  const draft: BlockDraft = {
    ...createDraft(),
    messages: [],
  };

  const withInstruction = upsertPromptDocumentPrimary(draft, "instruction", "Write the main prompt.");
  const withContext = upsertPromptDocumentPrimary(draft, "context", "System guidance.");

  assert.equal(withInstruction.messages.length, 1);
  assert.deepEqual(withInstruction.messages[0], { role: "user", content: "Write the main prompt." });
  assert.equal(withContext.messages.length, 1);
  assert.deepEqual(withContext.messages[0], { role: "system", content: "System guidance." });
});

test("addPromptDocumentPresetBlock appends message presets for document authoring", () => {
  const draft = createDraft();
  const withContext = addPromptDocumentPresetBlock(draft, "context");
  const withExample = addPromptDocumentPresetBlock(draft, "example");
  const withFormat = addPromptDocumentPresetBlock(draft, "output_format");
  const withConstraint = addPromptDocumentPresetBlock(draft, "constraint");

  assert.equal(withContext.messages.at(-1)?.content, "Additional context:\n");
  assert.equal(withExample.messages.at(-2)?.content, "Example input:\n");
  assert.equal(withExample.messages.at(-1)?.content, "Example output:\n");
  assert.match(withFormat.messages.at(-1)?.content ?? "", /Output format:/);
  assert.match(withConstraint.messages.at(-1)?.content ?? "", /Constraint:/);
});

test("describePromptDocumentMessage derives a compact label from message content", () => {
  assert.equal(describePromptDocumentMessage({ role: "developer", content: "Output format:\n- Return markdown." }, 2), "Output format:");
  assert.equal(describePromptDocumentMessage({ role: "assistant", content: "" }, 4), "Block 5");
});

test("createPromptDocumentModel classifies typed additional prompt blocks", () => {
  const draft: BlockDraft = {
    ...createDraft(),
    messages: [
      { role: "system", content: "Keep the writing practical." },
      { role: "user", content: "Explain why habits fail." },
      { role: "developer", content: "Additional context:\nUse practical examples." },
      { role: "user", content: "Example input:\nA vague goal." },
      { role: "assistant", content: "Example output:\nA concrete habit plan." },
      { role: "developer", content: "Output format:\n- Markdown bullets" },
      { role: "developer", content: "Constraint:\n- Avoid fluff." },
      { role: "assistant", content: "Freeform note" },
    ],
  };

  const model = createPromptDocumentModel(draft);

  assert.deepEqual(
    model.additionalBlocks.map((block) => [block.kind, block.title]),
    [
      ["context", "Additional Context"],
      ["example_input", "Example Input"],
      ["example_output", "Example Output"],
      ["output_format", "Output Format"],
      ["constraint", "Constraint"],
      ["generic", "Freeform note"],
    ],
  );
});

test("createPromptDocumentEditorData exports prompt document blocks for editor.js", () => {
  const output = createPromptDocumentEditorData(createDraft());
  assert.deepEqual(
    output.blocks.map((block) => block.type),
    ["promptInstruction", "context", "exampleOutput"],
  );
});

test("applyPromptDocumentEditorData converts editor.js blocks back into canonical message drafts", () => {
  const nextDraft = applyPromptDocumentEditorData(createDraft(), {
    blocks: [
      { type: "promptInstruction", data: { kind: "prompt_instruction", content: "Write a sharper instruction." } },
      { type: "context", data: { kind: "context", content: "Use a practical tone.", role: "system" } },
      { type: "exampleInput", data: { kind: "example_input", content: "Example input:\nA vague goal." } },
      { type: "exampleOutput", data: { kind: "example_output", content: "Example output:\nA concrete plan." } },
      { type: "outputFormat", data: { kind: "output_format", content: "Output format:\n- Markdown bullets" } },
      { type: "constraint", data: { kind: "constraint", content: "Constraint:\n- Avoid fluff." } },
      { type: "generic", data: { kind: "generic", role: "assistant", content: "Freeform note" } },
    ],
  });

  assert.deepEqual(nextDraft.messages, [
    { role: "user", content: "Write a sharper instruction." },
    { role: "system", content: "Use a practical tone." },
    { role: "user", content: "Example input:\nA vague goal." },
    { role: "assistant", content: "Example output:\nA concrete plan." },
    { role: "developer", content: "Output format:\n- Markdown bullets" },
    { role: "developer", content: "Constraint:\n- Avoid fluff." },
    { role: "assistant", content: "Freeform note" },
  ]);
});

test("workspace blocks roundtrip prompt messages and variables through the adapter", () => {
  const draft: BlockDraft = {
    ...createDraft(),
    messages: [
      { role: "user", content: "Write the opening section." },
      { role: "system", content: "[Context: Audience]\nSenior engineers." },
      { role: "user", content: "Example input:\nExplain transformers." },
      { role: "assistant", content: "Example output:\nA concise technical explanation." },
      { role: "developer", content: "Constraint:\n- Avoid hype." },
    ],
    inputs: [
      {
        name: "topic",
        type: "string",
        required: false,
        description: "",
        defaultValue: "\"AI architecture\"",
      },
    ],
  };

  const blocks = createPromptWorkspaceBlocks(draft);
  const nextDraft = applyPromptWorkspaceBlocks(draft, blocks);

  assert.deepEqual(nextDraft.messages, draft.messages);
  assert.deepEqual(nextDraft.inputs, draft.inputs);
});

test("compilePromptWorkspaceBlocks interpolates variables into the composed prompt", () => {
  const blocks = createPromptWorkspaceBlocks({
    ...createDraft(),
    messages: [
      { role: "user", content: "Write about {{topic}} for {{audience}}." },
      { role: "system", content: "[Context: Background]\nFocus on practical takeaways." },
    ],
    inputs: [
      {
        name: "topic",
        type: "string",
        required: false,
        description: "",
        defaultValue: "\"AI architecture\"",
      },
      {
        name: "audience",
        type: "string",
        required: false,
        description: "",
        defaultValue: "\"senior developers\"",
      },
    ],
  });

  const compiled = compilePromptWorkspaceBlocks(blocks);

  assert.match(compiled.text, /AI architecture/);
  assert.match(compiled.text, /senior developers/);
  assert.equal(compiled.activeBlockCount, 3);
});

test("workspace blocks roundtrip loop, conditional, and metadata blocks", () => {
  const draft: BlockDraft = {
    ...createDraft(),
    messages: [
      { role: "user", content: "Write about {{topic}}." },
      { role: "developer", content: "[Loop: item]\nItems: alpha, beta\nDiscuss {{item}} in relation to {{topic}}." },
      { role: "developer", content: "[Conditional: audience]\nTailor the explanation for {{audience}}." },
      { role: "developer", content: "[Metadata: Tone]\ntechnical" },
    ],
    inputs: [
      {
        name: "topic",
        type: "string",
        required: false,
        description: "",
        defaultValue: "\"AI architecture\"",
      },
      {
        name: "audience",
        type: "string",
        required: false,
        description: "",
        defaultValue: "\"senior developers\"",
      },
    ],
  };

  const blocks = createPromptWorkspaceBlocks(draft);
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["variables", "prompt", "loop", "conditional", "metadata"],
  );

  const nextDraft = applyPromptWorkspaceBlocks(draft, blocks);
  assert.deepEqual(nextDraft.messages, draft.messages);
});

test("compilePromptWorkspaceBlocks expands loop, conditional, and metadata blocks", () => {
  const compiled = compilePromptWorkspaceBlocks([
    {
      id: "prompt",
      kind: "prompt",
      enabled: true,
      collapsed: false,
      content: "Write about {{topic}}.",
    },
    {
      id: "variables",
      kind: "variables",
      enabled: true,
      collapsed: false,
      entries: [
        { key: "topic", value: "AI architecture" },
        { key: "audience", value: "senior developers" },
      ],
    },
    {
      id: "loop",
      kind: "loop",
      enabled: true,
      collapsed: false,
      variable: "item",
      items: "history, transformers",
      content: "Cover {{item}} for {{audience}}.",
    },
    {
      id: "conditional",
      kind: "conditional",
      enabled: true,
      collapsed: false,
      variable: "audience",
      content: "Target {{audience}}.",
    },
    {
      id: "metadata",
      kind: "metadata",
      enabled: true,
      collapsed: false,
      key: "Tone",
      value: "technical",
    },
  ]);

  assert.match(compiled.text, /Write about AI architecture\./);
  assert.match(compiled.text, /Cover history for senior developers\./);
  assert.match(compiled.text, /Cover transformers for senior developers\./);
  assert.match(compiled.text, /Target senior developers\./);
  assert.match(compiled.text, /Tone: technical/);
  assert.equal(compiled.activeBlockCount, 5);
});
