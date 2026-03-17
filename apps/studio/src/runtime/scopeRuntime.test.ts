import assert from "node:assert/strict";
import test from "node:test";
import { PromptSchema } from "@promptfarm/core";
import { executeRuntimeActionFromPrompt } from "./createRuntimePreview";
import { createRenderedPromptPreview } from "./scopeRuntime";
import {
  setStudioPromptDocumentLocalCacheAdapterForTests,
  setStudioPromptDocumentRemoteConfigForTests,
  writeStudioPromptDocumentToRemote,
} from "./studioPromptDocumentRemote";

const TREE_PROMPT = PromptSchema.parse({
  apiVersion: "promptfarm/v1",
  kind: "Prompt",
  metadata: {
    id: "tree_book",
    version: "1.0.0",
    title: "Tree Book",
  },
  spec: {
    artifact: {
      type: "book_text",
    },
    inputs: [],
    messages: [
      {
        role: "developer",
        content: "Write a structured book.",
      },
    ],
    use: [],
    buildTargets: [],
    blocks: [
      {
        id: "chapter_1",
        kind: "chapter",
        title: "Chapter 1",
        inputs: [],
        messages: [
          {
            role: "user",
            content: "Draft the chapter arc.",
          },
        ],
        children: [
          {
            id: "section_1",
            kind: "section",
            title: "Section 1",
            inputs: [],
            messages: [
              {
                role: "user",
                content: "Detail the first section.",
              },
            ],
            children: [],
          },
        ],
      },
    ],
  },
});

test("root rendered prompt preview assembles visible tree messages", () => {
  const preview = createRenderedPromptPreview(TREE_PROMPT, { mode: "root" }, "snapshot_hash");

  assert.equal(preview.scope.scopeRef, "root:tree_book");
  assert.equal(preview.inheritedMessageCount, 3);
  assert.equal(preview.selectedMessageCount, 3);
  assert.doesNotMatch(preview.renderedText ?? "", /^#\sTree Book/m);
  assert.doesNotMatch(preview.renderedText ?? "", /^id:\s/m);
  assert.match(preview.renderedText ?? "", /Write a structured book\./);
  assert.match(preview.renderedText ?? "", /Draft a clear, structured long-form chapter or section with logical flow and useful detail\./);
  assert.match(preview.renderedText ?? "", /Draft the chapter arc\./);
  assert.match(preview.renderedText ?? "", /Detail the first section\./);
});

test("rendered prompt uses source description as stable core task when present", () => {
  const prompt = PromptSchema.parse({
    ...TREE_PROMPT,
    metadata: {
      ...TREE_PROMPT.metadata,
      description: "Write a practical chapter that teaches one concept clearly and progressively.",
    },
    spec: {
      ...TREE_PROMPT.spec,
      messages: [
        {
          role: "developer",
          content: "Write a structured book.",
        },
      ],
      blocks: [
        {
          ...TREE_PROMPT.spec.blocks[0]!,
          messages: [
            {
              role: "user",
              content: "garbage subtree line",
            },
          ],
          children: [],
        },
      ],
    },
  });

  const preview = createRenderedPromptPreview(prompt, { mode: "root" }, "snapshot_hash");
  assert.match(preview.renderedText ?? "", /## Core Task/);
  assert.match(preview.renderedText ?? "", /Write a practical chapter that teaches one concept clearly and progressively\./);
  assert.doesNotMatch(preview.renderedText ?? "", /## Core Task\s+garbage subtree line/);
});

test("rendered prompt separates dependency guidance, dependency context, and runtime additions without cleaning entered text", async () => {
  const cache = (() => {
    const storage = new Map<string, string>();
    return {
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
      removeItem(key: string) {
        storage.delete(key);
      },
    };
  })();

  const dependencyPrompt = PromptSchema.parse({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: {
      id: "dep_skill",
      version: "1.0.0",
      title: "Dep Skill",
    },
    spec: {
      artifact: {
        type: "book_text",
      },
      inputs: [],
      messages: [
        {
          role: "system",
          content: "Keep the structure compact and practical.",
        },
        {
          role: "user",
          content: "Draft the phase objective, sequence, and constraints.",
        },
      ],
      use: [],
      buildTargets: [],
      blocks: [
        {
          id: "dep_note",
          kind: "chapter",
          title: "Dep Note",
          inputs: [],
          messages: [
            {
              role: "user",
              content: "Effective techniques for prioritizing rest, exercise, and nutrition.",
            },
          ],
          children: [],
        },
      ],
    },
  });

  const prompt = PromptSchema.parse({
    ...TREE_PROMPT,
    metadata: {
      ...TREE_PROMPT.metadata,
      description: "Write a practical chapter that teaches one concept clearly and progressively.",
    },
    spec: {
      ...TREE_PROMPT.spec,
      messages: [
        {
          role: "developer",
          content: "Write a structured book.",
        },
        {
          role: "system",
          content: "[Context: Runtime note]\nTemporary context for this run.",
        },
      ],
      use: [
        {
          prompt: "dep_skill",
          mode: "inline",
        },
      ],
      blocks: [
        {
          ...TREE_PROMPT.spec.blocks[0]!,
          messages: [
            {
              role: "user",
              content: "Draft the chapter arc.",
            },
            {
              role: "user",
              content: "garbageword 12323131",
            },
            {
              role: "user",
              content: "garbageword 12323131",
            },
          ],
        },
      ],
    },
  });

  try {
    setStudioPromptDocumentLocalCacheAdapterForTests(cache);
    setStudioPromptDocumentRemoteConfigForTests({ mode: "disabled" });
    await writeStudioPromptDocumentToRemote({ prompt: dependencyPrompt });

    const preview = createRenderedPromptPreview(prompt, { mode: "root" }, "snapshot_hash");

    assert.match(preview.renderedText ?? "", /## Dependency: Dep Skill/);
    assert.match(preview.renderedText ?? "", /Draft the phase objective, sequence, and constraints\./);
    assert.match(preview.renderedText ?? "", /### Context/);
    assert.match(preview.renderedText ?? "", /Effective techniques for prioritizing rest, exercise, and nutrition\./);
    assert.match(preview.renderedText ?? "", /## Runtime Additions/);
    assert.match(preview.renderedText ?? "", /\[Context: Runtime note\]/);
    assert.match(preview.renderedText ?? "", /garbageword 12323131/);
    assert.ok((preview.renderedText ?? "").match(/garbageword 12323131/g)?.length ?? 0 >= 2);
  } finally {
    setStudioPromptDocumentLocalCacheAdapterForTests(undefined);
    setStudioPromptDocumentRemoteConfigForTests(undefined);
  }
});

test("root resolve runtime action includes visible tree messages in the resolved artifact", () => {
  const result = executeRuntimeActionFromPrompt(TREE_PROMPT, "resolve", { mode: "root" });

  assert.equal(result.success, true);
  assert.equal(result.preview.context?.resolvedArtifact.messages.length, 3);
  assert.equal(result.preview.context?.resolvedArtifact.messages[0]?.content, "Write a structured book.");
  assert.equal(result.preview.context?.resolvedArtifact.messages[1]?.content, "Draft the chapter arc.");
  assert.equal(result.preview.context?.resolvedArtifact.messages[2]?.content, "Detail the first section.");
});

test("attached dependency contributes its assembled tree messages to root resolve", async () => {
  const cache = (() => {
    const storage = new Map<string, string>();
    return {
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
      removeItem(key: string) {
        storage.delete(key);
      },
    };
  })();

  const dependencyPrompt = PromptSchema.parse({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: {
      id: "dep_book",
      version: "1.0.0",
      title: "Dep Book",
    },
    spec: {
      artifact: {
        type: "book_text",
      },
      inputs: [],
      messages: [
        {
          role: "system",
          content: "Dependency root instruction.",
        },
      ],
      use: [],
      buildTargets: [],
      blocks: [
        {
          id: "dep_chapter",
          kind: "chapter",
          title: "Dep Chapter",
          inputs: [],
          messages: [
            {
              role: "user",
              content: "Dependency chapter instruction.",
            },
          ],
          children: [
            {
              id: "dep_section",
              kind: "section",
              title: "Dep Section",
              inputs: [],
              messages: [
                {
                  role: "user",
                  content: "Dependency section instruction.",
                },
              ],
              children: [],
            },
          ],
        },
      ],
    },
  });

  const promptWithDependency = PromptSchema.parse({
    ...TREE_PROMPT,
    spec: {
      ...TREE_PROMPT.spec,
      use: [
        {
          prompt: "dep_book",
          mode: "inline",
        },
      ],
    },
  });

  try {
    setStudioPromptDocumentLocalCacheAdapterForTests(cache);
    setStudioPromptDocumentRemoteConfigForTests({ mode: "disabled" });
    await writeStudioPromptDocumentToRemote({ prompt: dependencyPrompt });

    const result = executeRuntimeActionFromPrompt(promptWithDependency, "resolve", { mode: "root" });
    const contents = result.preview.context?.resolvedArtifact.messages.map((message) => message.content) ?? [];

    assert.equal(result.success, true);
    assert.ok(contents.includes("Dependency root instruction."));
    assert.ok(contents.includes("Dependency chapter instruction."));
    assert.ok(contents.includes("Dependency section instruction."));
  } finally {
    setStudioPromptDocumentLocalCacheAdapterForTests(undefined);
    setStudioPromptDocumentRemoteConfigForTests(undefined);
  }
});

test("block-scoped resolve does not pull global dependency tree composition", async () => {
  const cache = (() => {
    const storage = new Map<string, string>();
    return {
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
      removeItem(key: string) {
        storage.delete(key);
      },
    };
  })();

  const dependencyPrompt = PromptSchema.parse({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: {
      id: "dep_book",
      version: "1.0.0",
      title: "Dep Book",
    },
    spec: {
      artifact: {
        type: "book_text",
      },
      inputs: [],
      messages: [
        {
          role: "system",
          content: "Dependency root instruction.",
        },
      ],
      use: [],
      buildTargets: [],
      blocks: [
        {
          id: "dep_chapter",
          kind: "chapter",
          title: "Dep Chapter",
          inputs: [],
          messages: [
            {
              role: "user",
              content: "Dependency chapter instruction.",
            },
          ],
          children: [],
        },
      ],
    },
  });

  const promptWithDependency = PromptSchema.parse({
    ...TREE_PROMPT,
    spec: {
      ...TREE_PROMPT.spec,
      use: [
        {
          prompt: "dep_book",
          mode: "inline",
        },
      ],
    },
  });

  try {
    setStudioPromptDocumentLocalCacheAdapterForTests(cache);
    setStudioPromptDocumentRemoteConfigForTests({ mode: "disabled" });
    await writeStudioPromptDocumentToRemote({ prompt: dependencyPrompt });

    const result = executeRuntimeActionFromPrompt(promptWithDependency, "resolve", { mode: "block", blockId: "section_1" });
    const contents = result.preview.context?.resolvedArtifact.messages.map((message) => message.content) ?? [];

    assert.equal(result.success, true);
    assert.ok(contents.includes("Detail the first section."));
    assert.ok(!contents.includes("Write a structured book."));
    assert.ok(!contents.includes("Draft the chapter arc."));
    assert.ok(!contents.includes("Dependency root instruction."));
    assert.ok(!contents.includes("Dependency chapter instruction."));
  } finally {
    setStudioPromptDocumentLocalCacheAdapterForTests(undefined);
    setStudioPromptDocumentRemoteConfigForTests(undefined);
  }
});

test("block-scoped resolve includes selected subtree descendants", () => {
  const prompt = PromptSchema.parse({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: {
      id: "tree_book_subtree",
      version: "1.0.0",
      title: "Tree Book Subtree",
    },
    spec: {
      artifact: {
        type: "book_text",
      },
      inputs: [],
      messages: [
        {
          role: "developer",
          content: "Write a structured book.",
        },
      ],
      use: [],
      buildTargets: [],
      blocks: [
        {
          id: "chapter_1",
          kind: "chapter",
          title: "Chapter 1",
          inputs: [],
          messages: [
            {
              role: "user",
              content: "Draft the chapter arc.",
            },
          ],
          children: [
            {
              id: "section_1",
              kind: "section",
              title: "Section 1",
              inputs: [],
              messages: [
                {
                  role: "user",
                  content: "Detail the first section.",
                },
              ],
              children: [
                {
                  id: "block_1",
                  kind: "generic_block",
                  title: "Block 1",
                  inputs: [],
                  messages: [
                    {
                      role: "user",
                      content: "Describe the supporting block.",
                    },
                  ],
                  children: [],
                },
              ],
            },
            {
              id: "section_2",
              kind: "section",
              title: "Section 2",
              inputs: [],
              messages: [
                {
                  role: "user",
                  content: "Detail the second section.",
                },
              ],
              children: [],
            },
          ],
        },
      ],
    },
  });

  const chapterResult = executeRuntimeActionFromPrompt(prompt, "resolve", { mode: "block", blockId: "chapter_1" });
  const chapterContents = chapterResult.preview.context?.resolvedArtifact.messages.map((message) => message.content) ?? [];
  assert.ok(chapterContents.includes("Draft the chapter arc."));
  assert.ok(chapterContents.includes("Detail the first section."));
  assert.ok(chapterContents.includes("Describe the supporting block."));
  assert.ok(chapterContents.includes("Detail the second section."));
  assert.ok(!chapterContents.includes("Write a structured book."));

  const sectionResult = executeRuntimeActionFromPrompt(prompt, "resolve", { mode: "block", blockId: "section_1" });
  const sectionContents = sectionResult.preview.context?.resolvedArtifact.messages.map((message) => message.content) ?? [];
  assert.ok(sectionContents.includes("Detail the first section."));
  assert.ok(sectionContents.includes("Describe the supporting block."));
  assert.ok(!sectionContents.includes("Detail the second section."));
  assert.ok(!sectionContents.includes("Write a structured book."));
  assert.ok(!sectionContents.includes("Draft the chapter arc."));
});

test("block rendered prompt keeps selected node objective separate from descendant details", () => {
  const prompt = PromptSchema.parse({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: {
      id: "tree_book_scope_sections",
      version: "1.0.0",
      title: "Tree Book Scope Sections",
    },
    spec: {
      artifact: {
        type: "book_text",
      },
      inputs: [],
      messages: [
        {
          role: "system",
          content: "You write structured book text with clear sections and factual flow.",
        },
      ],
      use: [],
      buildTargets: [],
      blocks: [
        {
          id: "chapter_1",
          kind: "chapter",
          title: "Chapter 1",
          inputs: [],
          messages: [
            {
              role: "user",
              content: "Draft the chapter structure, arc, and key subsections.",
            },
          ],
          children: [
            {
              id: "section_1",
              kind: "section",
              title: "Section 1",
              inputs: [],
              messages: [
                {
                  role: "user",
                  content: "Draft this section with focused detail and continuity.",
                },
              ],
              children: [],
            },
          ],
        },
      ],
    },
  });

  const preview = createRenderedPromptPreview(prompt, { mode: "block", blockId: "chapter_1" }, "snapshot_hash");
  assert.match(preview.renderedText ?? "", /## Scope Objective\s+Draft the chapter structure, arc, and key subsections\./);
  assert.match(preview.renderedText ?? "", /## Scope Tree[\s\S]*#### section: Section 1[\s\S]*Draft this section with focused detail and continuity\./);
  assert.doesNotMatch(preview.renderedText ?? "", /## Scope Details/);
});

test("root rendered prompt does not duplicate runtime additions from tree assembly", () => {
  const prompt = PromptSchema.parse({
    apiVersion: "promptfarm/v1",
    kind: "Prompt",
    metadata: {
      id: "tree_book_runtime_additions",
      version: "1.0.0",
      title: "Tree Book Runtime Additions",
    },
    spec: {
      artifact: {
        type: "book_text",
      },
      inputs: [],
      messages: [
        {
          role: "system",
          content: "You write structured book text with clear sections and factual flow.",
        },
        {
          role: "system",
          content: "[Context: Runtime note]\nTemporary context for this run.",
        },
      ],
      use: [],
      buildTargets: [],
      blocks: [
        {
          id: "chapter_1",
          kind: "chapter",
          title: "Chapter 1",
          inputs: [],
          messages: [
            {
              role: "user",
              content: "Draft the chapter arc.",
            },
          ],
          children: [],
        },
      ],
    },
  });

  const preview = createRenderedPromptPreview(prompt, { mode: "root" }, "snapshot_hash");
  assert.equal((preview.renderedText ?? "").match(/\[Context: Runtime note\]/g)?.length ?? 0, 1);
});
