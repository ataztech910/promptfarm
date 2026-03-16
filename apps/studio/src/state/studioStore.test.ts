import assert from "node:assert/strict";
import test from "node:test";
import { PromptSchema, createNodeExecutionRecord } from "@promptfarm/core";
import YAML from "yaml";
import { resetStudioStoreForTests, setStudioPersistenceAdapterForTests, useStudioStore } from "./studioStore";
import {
  setStudioNodeLlmClientForTests,
  setStudioNodeLlmModelDiscoveryTransportForTests,
} from "../runtime/nodeLlmClient";
import { createInMemoryStudioPersistenceAdapter } from "../runtime/studioPersistence";
import { setStudioExecutionRemoteConfigForTests, setStudioExecutionRemoteTransportForTests } from "../runtime/studioExecutionRemote";
import { buildGraphProposalInstruction, buildGraphProposalUserPrompt, createGraphProposalFromResponse } from "../runtime/graphProposal";
import { parseMessageSuggestionResponse } from "../runtime/messageSuggestion";

function rootPromptSelectionId(store: ReturnType<typeof useStudioStore.getState>): string {
  if (!store.canonicalPrompt) {
    throw new Error("Expected canonical prompt");
  }
  return `prompt:${store.canonicalPrompt.metadata.id}`;
}

async function flushNodeRunQueue(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function installMockNodeLlmClient(): void {
  setStudioNodeLlmClientForTests({
    async generateText(input) {
      const lastMessage = input.messages[input.messages.length - 1]?.content ?? "";
      return {
        outputText: `Generated output: ${lastMessage}`,
        provider: "mock",
        model: "mock-model",
        generatedAt: new Date("2026-03-15T10:00:00.000Z"),
        executionTimeMs: 12,
      };
    },
  });
}

function installProfileAwareMockNodeLlmClient(): void {
  setStudioNodeLlmClientForTests((settings) => ({
    async generateText(input) {
      const lastMessage = input.messages[input.messages.length - 1]?.content ?? "";
      return {
        outputText: `[${settings.model}] ${lastMessage}`,
        provider: settings.providerLabel || "mock",
        model: settings.model,
        generatedAt: new Date("2026-03-15T10:00:00.000Z"),
        executionTimeMs: settings.model.includes("mistral") ? 8 : 12,
      };
    },
  }));
}

function installMockNodeLlmModelDiscovery(): void {
  setStudioNodeLlmModelDiscoveryTransportForTests(async ({ url }) => {
    if (url.endsWith("/api/tags")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            models: [{ name: "llama3.2:latest" }, { name: "mistral:latest" }],
          };
        },
        async text() {
          return "";
        },
      };
    }

    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return {
          data: [{ id: "gpt-5-mini" }, { id: "gpt-5" }],
        };
      },
      async text() {
        return "";
      },
    };
  });
}

function installGraphProposalAwareMockNodeLlmClient(): void {
  setStudioNodeLlmClientForTests({
    async generateText(input) {
      const joinedMessages = input.messages.map((message) => message.content).join("\n");
      if (joinedMessages.includes("Return only valid JSON.")) {
        return {
          outputText: JSON.stringify({
            summary: "Add one proposed chapter",
            blocks: [
              {
                kind: "chapter",
                title: "Proposed Chapter",
                description: "Generated preview chapter",
                instruction: "Draft the proposed chapter in a concise way.",
                children: [],
              },
            ],
          }),
          provider: "mock",
          model: "mock-model",
          generatedAt: new Date("2026-03-15T10:00:00.000Z"),
          executionTimeMs: 15,
        };
      }

      const tailMessage = input.messages[input.messages.length - 1]?.content ?? "";
      return {
        outputText: `Generated output: ${tailMessage}`,
        provider: "mock",
        model: "mock-model",
        generatedAt: new Date("2026-03-15T10:00:00.000Z"),
        executionTimeMs: 12,
      };
    },
  });
}

function installMalformedGraphProposalMockNodeLlmClient(): void {
  setStudioNodeLlmClientForTests({
    async generateText(input) {
      const joinedMessages = input.messages.map((message) => message.content).join("\n");
      if (joinedMessages.includes("Return only valid JSON.")) {
        return {
          outputText:
            '{"summary":"Add one proposed chapter","blocks":[{"kind":"chapter","title":"Loose JSON Chapter","description":"Generated preview chapter","instruction":"Draft the proposed chapter in a concise way.","children":[],},],}',
          provider: "mock",
          model: "mock-model",
          generatedAt: new Date("2026-03-15T10:00:00.000Z"),
          executionTimeMs: 15,
        };
      }

      const tailMessage = input.messages[input.messages.length - 1]?.content ?? "";
      return {
        outputText: `Generated output: ${tailMessage}`,
        provider: "mock",
        model: "mock-model",
        generatedAt: new Date("2026-03-15T10:00:00.000Z"),
        executionTimeMs: 12,
      };
    },
  });
}

function installMessageSuggestionAwareMockNodeLlmClient(): void {
  setStudioNodeLlmClientForTests({
    async generateText(input) {
      const joinedMessages = input.messages.map((message) => message.content).join("\n");
      if (
        joinedMessages.includes("You are drafting canonical PromptFarm messages from title and description.") ||
        joinedMessages.includes("You are reorganizing an existing PromptFarm prompt draft into stronger canonical messages.")
      ) {
        return {
          outputText: JSON.stringify({
            summary: "Drafted root prompt messages",
            messages: [
              {
                role: "system",
                content: "You are a practical non-fiction book architect and writer.",
              },
              {
                role: "user",
                content: "Create a practical beginner-friendly book about habit building with a clear chapter structure and useful takeaways.",
              },
            ],
          }),
          provider: "mock",
          model: "mock-model",
          generatedAt: new Date("2026-03-15T10:00:00.000Z"),
          executionTimeMs: 11,
        };
      }

      const tailMessage = input.messages[input.messages.length - 1]?.content ?? "";
      return {
        outputText: `Generated output: ${tailMessage}`,
        provider: "mock",
        model: "mock-model",
        generatedAt: new Date("2026-03-15T10:00:00.000Z"),
        executionTimeMs: 12,
      };
    },
  });
}

function installRetryingGraphProposalMockNodeLlmClient(): void {
  let structureAttempts = 0;
  setStudioNodeLlmClientForTests({
    async generateText(input) {
      const joinedMessages = input.messages.map((message) => message.content).join("\n");
      if (joinedMessages.includes("Return only valid JSON.")) {
        structureAttempts += 1;
        if (structureAttempts === 1) {
          return {
            outputText: JSON.stringify({
              summary: "Broken structure",
              blocks: [],
            }),
            provider: "mock",
            model: "mock-model",
            generatedAt: new Date("2026-03-15T10:00:00.000Z"),
            executionTimeMs: 15,
          };
        }

        return {
          outputText: JSON.stringify({
            summary: "Recovered structure",
            blocks: [
              {
                kind: "chapter",
                title: "Recovered Chapter",
                description: "Generated after retry",
                instruction: "Draft the recovered chapter in a concise way.",
                children: [],
              },
            ],
          }),
          provider: "mock",
          model: "mock-model",
          generatedAt: new Date("2026-03-15T10:00:00.000Z"),
          executionTimeMs: 15,
        };
      }

      return {
        outputText: "Generated output",
        provider: "mock",
        model: "mock-model",
        generatedAt: new Date("2026-03-15T10:00:00.000Z"),
        executionTimeMs: 12,
      };
    },
  });
}

function installRetryingMessageSuggestionMockNodeLlmClient(): void {
  let suggestionAttempts = 0;
  setStudioNodeLlmClientForTests({
    async generateText(input) {
      const joinedMessages = input.messages.map((message) => message.content).join("\n");
      if (
        joinedMessages.includes("You are drafting canonical PromptFarm messages from title and description.") ||
        joinedMessages.includes("You are reorganizing an existing PromptFarm prompt draft into stronger canonical messages.")
      ) {
        suggestionAttempts += 1;
        if (suggestionAttempts === 1) {
          return {
            outputText: '{"summary":"Broken messages","messages":[{"role":"system","content":{',
            provider: "mock",
            model: "mock-model",
            generatedAt: new Date("2026-03-15T10:00:00.000Z"),
            executionTimeMs: 11,
          };
        }

        return {
          outputText: JSON.stringify({
            summary: "Recovered root prompt messages",
            messages: [
              {
                role: "system",
                content: "You are a practical non-fiction book architect and writer.",
              },
              {
                role: "user",
                content: "Create a practical beginner-friendly book about habit building with a clear chapter structure and useful takeaways.",
              },
            ],
          }),
          provider: "mock",
          model: "mock-model",
          generatedAt: new Date("2026-03-15T10:00:00.000Z"),
          executionTimeMs: 11,
        };
      }

      return {
        outputText: "Generated output",
        provider: "mock",
        model: "mock-model",
        generatedAt: new Date("2026-03-15T10:00:00.000Z"),
        executionTimeMs: 12,
      };
    },
  });
}

const ROUNDTRIP_FIXTURE_YAML = `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: sprint9_roundtrip
  version: 1.0.0
  title: Sprint 9 Roundtrip
  tags:
    - studio
spec:
  artifact:
    type: instruction
  inputs:
    - name: target
      type: string
      required: true
  messages:
    - role: system
      content: Initial guidance
  use:
    - prompt: base
      mode: inline
      with:
        locale: en-US
  evaluation:
    reviewerRoles:
      - id: manager
    rubric:
      criteria:
        - id: correctness
          title: Correctness
          weight: 1
          maxScore: 5
    qualityGates:
      - metric: overall
        operator: ">="
        threshold: 0
  buildTargets:
    - id: markdown
      format: md
      outputPath: dist/out.md
      options:
        lineWidth: 88
`;

const RUNTIME_SUCCESS_FIXTURE_YAML = `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: runtime_actions_ok
  version: 1.0.0
  title: Runtime Actions OK
spec:
  artifact:
    type: instruction
  inputs:
    - name: target
      type: string
      required: true
  messages:
    - role: system
      content: You are precise.
  evaluation:
    reviewerRoles:
      - id: manager
    rubric:
      criteria:
        - id: correctness
          title: Correctness
          weight: 1
          maxScore: 5
    qualityGates:
      - metric: overall
        operator: ">="
        threshold: 0
  buildTargets:
    - id: markdown
      format: md
      outputPath: dist/out.md
`;

const TREE_FIXTURE_YAML = `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: tree_book
  version: 1.0.0
  title: Tree Book
spec:
  artifact:
    type: book_text
  messages:
    - role: system
      content: Write a structured book.
  buildTargets:
    - id: markdown
      format: md
      outputPath: dist/book.md
      options:
        lineWidth: 72
  blocks:
    - id: chapter_1
      kind: chapter
      title: Chapter 1
      messages:
        - role: user
          content: Draft the chapter arc.
      children:
        - id: section_1
          kind: section
          title: Section 1
          messages:
            - role: user
              content: Detail the first section.
`;

const TREE_EVAL_FIXTURE_YAML = `apiVersion: promptfarm/v1
kind: Prompt
metadata:
  id: tree_eval
  version: 1.0.0
  title: Tree Eval
spec:
  artifact:
    type: instruction
  messages:
    - role: system
      content: Root instruction guidance.
  evaluation:
    reviewerRoles:
      - id: manager
    rubric:
      criteria:
        - id: correctness
          title: Correctness
          weight: 1
          maxScore: 5
    qualityGates:
      - metric: overall
        operator: ">="
        threshold: 0
  buildTargets:
    - id: markdown
      format: md
      outputPath: dist/tree_eval.md
  blocks:
    - id: phase_1
      kind: phase
      title: Phase 1
      messages:
        - role: user
          content: Plan the implementation phase.
      children:
        - id: step_group_1
          kind: step_group
          title: Step Group 1
          messages:
            - role: user
              content: Detail the execution steps.
`;

test("load -> edit -> save roundtrip preserves canonical structure", () => {
  resetStudioStoreForTests(ROUNDTRIP_FIXTURE_YAML);
  const store = useStudioStore.getState();
  assert.equal(store.nodes.some((node) => node.id.startsWith("build:")), false);
  assert.equal(store.nodes.some((node) => node.data.kind === "prompt"), true);

  store.applyGraphIntent({
    type: "node.patch",
    nodeId: rootPromptSelectionId(store),
    changes: {
      title: "Sprint 9 Updated",
      tags: "studio, persisted",
    },
  });

  const saved = useStudioStore.getState().savePrompt();
  assert.ok(saved, "expected save result");
  const parsed = PromptSchema.parse(YAML.parse(saved.yamlText));

  assert.equal(parsed.metadata.title, "Sprint 9 Updated");
  assert.deepEqual(parsed.metadata.tags, ["studio", "persisted"]);
  assert.equal(saved.filename, "sprint9_roundtrip.prompt.yaml");
});

test("artifact inspector configuration patches primary build target without creating build nodes", () => {
  resetStudioStoreForTests(ROUNDTRIP_FIXTURE_YAML);
  const store = useStudioStore.getState();

  store.applyGraphIntent({
    type: "node.patch",
    nodeId: rootPromptSelectionId(store),
    changes: {
      artifactType: "course",
      buildTarget: "json",
    },
  });

  const next = useStudioStore.getState();
  assert.equal(next.nodes.some((node) => node.id.startsWith("build:")), false);
  assert.equal(next.canonicalPrompt?.spec.artifact.type, "course");
  assert.equal(next.canonicalPrompt?.spec.buildTargets[0]?.id, "json");
  assert.equal(next.canonicalPrompt?.spec.buildTargets[0]?.format, "json");
});

test("save does not drop unsupported/read-only advanced fields", () => {
  resetStudioStoreForTests(ROUNDTRIP_FIXTURE_YAML);
  const store = useStudioStore.getState();

  store.applyGraphIntent({
    type: "node.patch",
    nodeId: rootPromptSelectionId(store),
    changes: {
      messages: [
        {
          role: "system",
          content: "Updated guidance",
        },
      ],
    },
  });

  const saved = useStudioStore.getState().savePrompt();
  assert.ok(saved, "expected save result");
  const parsed = PromptSchema.parse(YAML.parse(saved.yamlText));

  assert.deepEqual(parsed.spec.use[0]?.with, { locale: "en-US" });
  assert.deepEqual(parsed.spec.buildTargets[0]?.options, { lineWidth: 88 });
  assert.ok(parsed.spec.evaluation);
});

test("dirty state toggles with edit/save and yaml draft changes", () => {
  resetStudioStoreForTests(ROUNDTRIP_FIXTURE_YAML);
  let store = useStudioStore.getState();
  assert.equal(store.isDirty, false);
  assert.equal(store.hasYamlDraftChanges, false);

  store.setYamlText(`${store.yamlText}\n`);
  store = useStudioStore.getState();
  assert.equal(store.hasYamlDraftChanges, true);
  assert.equal(store.isDirty, false);

  store.applyGraphIntent({
    type: "node.patch",
    nodeId: rootPromptSelectionId(store),
    changes: {
      inputs: [
        {
          name: "target",
          type: "string",
          required: true,
          description: "Target entity name",
        },
      ],
    },
  });

  store = useStudioStore.getState();
  assert.equal(store.isDirty, true);
  assert.equal(store.hasYamlDraftChanges, false);

  store.savePrompt();
  store = useStudioStore.getState();
  assert.equal(store.isDirty, false);
  assert.equal(store.hasYamlDraftChanges, false);
});

test("resetToSaved restores canonical prompt after edits", () => {
  resetStudioStoreForTests(ROUNDTRIP_FIXTURE_YAML);
  const before = useStudioStore.getState();
  assert.ok(before.canonicalPrompt, "expected canonical prompt");
  const initialTitle = before.canonicalPrompt.metadata.title;

  before.applyGraphIntent({
    type: "node.patch",
    nodeId: rootPromptSelectionId(before),
    changes: {
      title: "Temporary Title",
    },
  });

  let current = useStudioStore.getState();
  assert.ok(current.canonicalPrompt, "expected canonical prompt");
  assert.equal(current.canonicalPrompt.metadata.title, "Temporary Title");
  assert.equal(current.isDirty, true);

  current.resetToSaved();
  current = useStudioStore.getState();
  assert.ok(current.canonicalPrompt, "expected canonical prompt");
  assert.equal(current.canonicalPrompt.metadata.title, initialTitle);
  assert.equal(current.isDirty, false);
});

test("selection initializes an explicit editor draft session", () => {
  resetStudioStoreForTests(ROUNDTRIP_FIXTURE_YAML);
  const store = useStudioStore.getState();
  const promptRef = rootPromptSelectionId(store);

  assert.equal(store.activeEditorRef, promptRef);
  assert.equal(store.editorDrafts[promptRef]?.draft.entityKind, "prompt");
  assert.equal(store.editorDrafts[promptRef]?.dirty, false);
});

test("message assist drafts prompt messages from title and description", async () => {
  installMessageSuggestionAwareMockNodeLlmClient();
  resetStudioStoreForTests(ROUNDTRIP_FIXTURE_YAML);
  let store = useStudioStore.getState();
  const promptRef = rootPromptSelectionId(store);
  const promptDraft = store.editorDrafts[promptRef]?.draft;
  assert.ok(promptDraft && promptDraft.entityKind === "prompt", "expected prompt draft");

  store.setNodeLlmSettings({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3.2:latest",
    providerLabel: "ollama_openai",
  });
  store.updateActiveEditorDraft({
    ...promptDraft,
    title: "Habits Without Burnout",
    description: "Practical beginner-friendly non-fiction book about sustainable habit building.",
  });

  await store.suggestMessagesForActiveDraft();
  store = useStudioStore.getState();

  assert.equal(store.messageSuggestion.status, "success");
  assert.equal(store.messageSuggestion.suggestedMessages[0]?.role, "system");
  assert.match(store.messageSuggestion.suggestedMessages[1]?.content ?? "", /habit building/i);

  store.applyMessageSuggestionToActiveDraft();
  store = useStudioStore.getState();
  const nextDraft = store.editorDrafts[promptRef]?.draft;
  assert.ok(nextDraft && nextDraft.entityKind === "prompt", "expected prompt draft after apply");
  assert.equal(nextDraft.messages[0]?.role, "system");
  assert.match(nextDraft.messages[1]?.content ?? "", /habit building/i);
});

test("message assist retries once when the first response does not match canonical message format", async () => {
  installRetryingMessageSuggestionMockNodeLlmClient();
  resetStudioStoreForTests(ROUNDTRIP_FIXTURE_YAML);
  let store = useStudioStore.getState();
  const promptRef = rootPromptSelectionId(store);
  const promptDraft = store.editorDrafts[promptRef]?.draft;
  assert.ok(promptDraft && promptDraft.entityKind === "prompt", "expected prompt draft");

  store.setNodeLlmSettings({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3.2:latest",
    providerLabel: "ollama_openai",
  });
  store.updateActiveEditorDraft({
    ...promptDraft,
    title: "Habits Without Burnout",
    description: "Practical beginner-friendly non-fiction book about sustainable habit building.",
  });

  await store.suggestMessagesForActiveDraft();
  store = useStudioStore.getState();

  assert.equal(store.messageSuggestion.status, "success");
  assert.match(store.messageSuggestion.summary ?? "", /Recovered root prompt messages/i);
  assert.match(store.messageSuggestion.suggestedMessages[1]?.content ?? "", /habit building/i);
});

test("message suggestion parser tolerates doubled braces and object text content", () => {
  const parsed = parseMessageSuggestionResponse(
    '{"summary":"Drafted messages","messages":[{"role":"system","content":{{"text":"Create a clear chapter structure for a practical non-fiction prompt"}}},{"role":"user","content":"Draft the prompt so the model writes useful chapters."}]}',
  );

  assert.equal(parsed.messages[0]?.role, "system");
  assert.match(parsed.messages[0]?.content ?? "", /clear chapter structure/i);
  assert.equal(parsed.messages[1]?.role, "user");
});

test("editing an active draft marks the session dirty and apply commits back to canonical", () => {
  resetStudioStoreForTests(ROUNDTRIP_FIXTURE_YAML);
  let store = useStudioStore.getState();
  const promptRef = rootPromptSelectionId(store);
  const promptDraft = store.editorDrafts[promptRef]?.draft;
  assert.ok(promptDraft && promptDraft.entityKind === "prompt", "expected prompt draft");

  store.updateActiveEditorDraft({
    ...promptDraft,
    title: "Stable Session Title",
  });

  store = useStudioStore.getState();
  assert.equal(store.editorDrafts[promptRef]?.dirty, true);

  store.applyActiveEditorDraft();
  store = useStudioStore.getState();

  assert.equal(store.canonicalPrompt?.metadata.title, "Stable Session Title");
  assert.equal(store.editorDrafts[promptRef]?.dirty, false);
  assert.equal(store.editorDrafts[promptRef]?.validationError, null);
});

test("invalid draft does not corrupt canonical state", () => {
  resetStudioStoreForTests(ROUNDTRIP_FIXTURE_YAML);
  let store = useStudioStore.getState();
  const promptRef = rootPromptSelectionId(store);
  const promptDraft = store.editorDrafts[promptRef]?.draft;
  assert.ok(promptDraft && promptDraft.entityKind === "prompt", "expected prompt draft");

  store.updateActiveEditorDraft({
    ...promptDraft,
    inputs: promptDraft.inputs.map((input, index) =>
      index === 0
        ? {
            ...input,
            defaultValue: "{broken json",
          }
        : input,
    ),
  });

  store.applyActiveEditorDraft();
  store = useStudioStore.getState();

  assert.equal(store.canonicalPrompt?.spec.inputs[0]?.default, undefined);
  assert.equal(
    store.editorDrafts[promptRef]?.validationError,
    'Input "target" default must be valid JSON.',
  );
});

test("selection change preserves dirty drafts instead of discarding them", () => {
  resetStudioStoreForTests(TREE_FIXTURE_YAML);
  let store = useStudioStore.getState();

  store.setSelectedNodeId("block:chapter_1");
  store = useStudioStore.getState();
  const chapterDraft = store.editorDrafts["block:chapter_1"]?.draft;
  assert.ok(chapterDraft && chapterDraft.entityKind === "block", "expected block draft");

  store.updateActiveEditorDraft({
    ...chapterDraft,
    title: "Draft Chapter Title",
  });
  store.setSelectedNodeId(rootPromptSelectionId(store));
  store = useStudioStore.getState();

  assert.equal(store.activeEditorRef, rootPromptSelectionId(store));
  assert.equal(store.editorDrafts["block:chapter_1"]?.dirty, true);
  assert.equal(
    store.editorDrafts["block:chapter_1"]?.draft.entityKind === "block"
      ? store.editorDrafts["block:chapter_1"]?.draft.title
      : null,
    "Draft Chapter Title",
  );
});

test("node creation does not wipe an existing dirty draft session", () => {
  resetStudioStoreForTests(TREE_FIXTURE_YAML);
  let store = useStudioStore.getState();

  store.setSelectedNodeId("block:chapter_1");
  store = useStudioStore.getState();
  const chapterDraft = store.editorDrafts["block:chapter_1"]?.draft;
  assert.ok(chapterDraft && chapterDraft.entityKind === "block", "expected block draft");

  store.updateActiveEditorDraft({
    ...chapterDraft,
    title: "Unsaved Chapter Draft",
  });
  store.applyGraphIntent({
    type: "block.add",
    kind: "section",
    parentBlockId: "chapter_1",
  });
  store = useStudioStore.getState();

  assert.equal(store.editorDrafts["block:chapter_1"]?.dirty, true);
  assert.equal(
    store.editorDrafts["block:chapter_1"]?.draft.entityKind === "block"
      ? store.editorDrafts["block:chapter_1"]?.draft.title
      : null,
    "Unsaved Chapter Draft",
  );
});

test("graph regeneration from focus changes does not wipe the active draft", () => {
  resetStudioStoreForTests(TREE_FIXTURE_YAML);
  let store = useStudioStore.getState();

  store.setSelectedNodeId("block:chapter_1");
  store = useStudioStore.getState();
  const chapterDraft = store.editorDrafts["block:chapter_1"]?.draft;
  assert.ok(chapterDraft && chapterDraft.entityKind === "block", "expected block draft");

  store.updateActiveEditorDraft({
    ...chapterDraft,
    title: "Focused Draft Title",
  });
  store.focusBlock("chapter_1");
  store = useStudioStore.getState();

  assert.equal(store.activeEditorRef, "block:chapter_1");
  assert.equal(store.editorDrafts["block:chapter_1"]?.dirty, true);
  assert.equal(
    store.editorDrafts["block:chapter_1"]?.draft.entityKind === "block"
      ? store.editorDrafts["block:chapter_1"]?.draft.title
      : null,
    "Focused Draft Title",
  );
});

test("selected scope prompt preview distinguishes root and block scopes", () => {
  resetStudioStoreForTests(TREE_FIXTURE_YAML);
  let store = useStudioStore.getState();

  assert.equal(store.selectedScopePromptPreview?.scope.mode, "root");
  assert.equal(store.selectedScopePromptPreview?.scope.scopeRef, "root:tree_book");

  store.setSelectedNodeId("block:chapter_1");
  store = useStudioStore.getState();

  assert.equal(store.selectedScopePromptPreview?.scope.mode, "block");
  assert.equal(store.selectedScopePromptPreview?.scope.scopeRef, "block:chapter_1");
});

test("scoped rendered prompt preview includes inherited and selected block context", () => {
  resetStudioStoreForTests(TREE_FIXTURE_YAML);
  const store = useStudioStore.getState();

  store.setSelectedNodeId("block:section_1");
  const next = useStudioStore.getState();

  assert.equal(next.selectedScopePromptPreview?.scope.scopeRef, "block:section_1");
  assert.equal(next.selectedScopePromptPreview?.inheritedMessageCount, 2);
  assert.equal(next.selectedScopePromptPreview?.selectedMessageCount, 1);
  assert.match(next.selectedScopePromptPreview?.renderedText ?? "", /Write a structured book\./);
  assert.match(next.selectedScopePromptPreview?.renderedText ?? "", /Draft the chapter arc\./);
  assert.match(next.selectedScopePromptPreview?.renderedText ?? "", /Detail the first section\./);
});

test("switching selection updates prompt preview scope and falls back to root", () => {
  resetStudioStoreForTests(TREE_FIXTURE_YAML);
  const store = useStudioStore.getState();

  store.setSelectedNodeId("block:chapter_1");
  assert.equal(useStudioStore.getState().selectedScopePromptPreview?.scope.scopeRef, "block:chapter_1");

  store.setSelectedNodeId(null);
  assert.equal(useStudioStore.getState().selectedScopePromptPreview?.scope.scopeRef, "root:tree_book");
});

test("selected scope runtime actions store latest scope output cleanly", () => {
  resetStudioStoreForTests(TREE_EVAL_FIXTURE_YAML);
  let store = useStudioStore.getState();

  store.setSelectedNodeId("block:phase_1");
  store.runSelectedScopeRuntimeAction("resolve");
  store = useStudioStore.getState();

  assert.equal(store.latestScopeOutputs["block:phase_1"]?.action, "resolve");
  assert.equal(store.latestScopeOutputs["block:phase_1"]?.contentType, "resolved_artifact");
  assert.equal(store.runtimePreview.scope?.mode, "block");
  assert.equal(store.runtimePreview.scope?.blockId, "phase_1");

  store.runSelectedScopeRuntimeAction("evaluate");
  store = useStudioStore.getState();
  assert.equal(store.latestScopeOutputs["block:phase_1"]?.action, "evaluate");
  assert.equal(store.latestScopeOutputs["block:phase_1"]?.contentType, "evaluation");
});

test("node llm settings persist across prompt edits and can reset to env defaults", () => {
  resetStudioStoreForTests(TREE_EVAL_FIXTURE_YAML);
  let store = useStudioStore.getState();

  store.setNodeLlmSettings({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3.2",
    providerLabel: "ollama_openai",
  });

  store.applyGraphIntent({
    type: "block.patch",
    blockId: "phase_1",
    changes: {
      title: "Phase 1 Updated",
    },
  });

  store = useStudioStore.getState();
  assert.deepEqual(store.nodeLlmSettings, {
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3.2",
    providerLabel: "ollama_openai",
  });

  store.resetNodeLlmSettings();
  store = useStudioStore.getState();
  assert.deepEqual(store.nodeLlmSettings, {
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3.2",
    providerLabel: "ollama_openai",
  });
});

test("node llm presets fill provider defaults for local ollama and openai cloud", () => {
  resetStudioStoreForTests(TREE_EVAL_FIXTURE_YAML);
  let store = useStudioStore.getState();

  store.applyNodeLlmPreset("ollama_local");
  store = useStudioStore.getState();
  assert.deepEqual(store.nodeLlmSettings, {
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3.2",
    providerLabel: "ollama_openai",
  });

  store.applyNodeLlmPreset("openai_cloud");
  store = useStudioStore.getState();
  assert.deepEqual(store.nodeLlmSettings, {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "llama3.2",
    providerLabel: "openai",
  });
});

test("studio bootstraps a local ollama profile and assigns it on the root by default", () => {
  resetStudioStoreForTests(TREE_EVAL_FIXTURE_YAML);
  const store = useStudioStore.getState();
  const bootstrappedProfileId = store.nodeLlmProfileOrder[0];
  assert.ok(bootstrappedProfileId, "expected a bootstrapped profile");
  assert.equal(store.nodeLlmProfiles[bootstrappedProfileId!]?.name, "Ollama Local");
  assert.deepEqual(store.nodeModelAssignments.prompt_root_tree_eval, [bootstrappedProfileId]);
});

test("node llm profiles are global registry entries and can be assigned on the root", () => {
  resetStudioStoreForTests(TREE_EVAL_FIXTURE_YAML);
  let store = useStudioStore.getState();
  const initialProfileCount = store.nodeLlmProfileOrder.length;

  store.setNodeLlmSettings({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3.2:latest",
    providerLabel: "ollama_openai",
  });
  const rootProfileId = store.saveNodeLlmProfile({ name: "Local Llama" });
  assert.ok(rootProfileId, "expected root profile id");

  store.setNodeLlmSettings({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "mistral:latest",
    providerLabel: "ollama_openai",
  });
  const secondProfileId = useStudioStore.getState().saveNodeLlmProfile({ name: "Local Mistral" });
  assert.ok(secondProfileId, "expected second profile id");

  store = useStudioStore.getState();
  assert.equal(store.nodeLlmProfileOrder.length, initialProfileCount + 2);

  const promptRuntimeNodeId = "prompt_root_tree_eval";
  store.setNodeModelAssignments(promptRuntimeNodeId, [rootProfileId!, secondProfileId!]);
  store = useStudioStore.getState();

  assert.deepEqual(store.nodeModelAssignments[promptRuntimeNodeId], [rootProfileId, secondProfileId]);
});

test("node llm model discovery loads local ollama models and keeps them in catalog", async () => {
  installMockNodeLlmModelDiscovery();
  resetStudioStoreForTests(TREE_EVAL_FIXTURE_YAML);
  let store = useStudioStore.getState();

  store.applyNodeLlmPreset("ollama_local");
  await useStudioStore.getState().refreshNodeLlmModels();

  store = useStudioStore.getState();
  assert.equal(store.nodeLlmModelCatalog.status, "success");
  assert.deepEqual(store.nodeLlmModelCatalog.models, ["llama3.2:latest", "mistral:latest"]);
  assert.equal(store.nodeLlmModelCatalog.source, "ollama_tags");
  assert.equal(store.nodeLlmSettings.model, "llama3.2");

  store.selectNodeLlmModel("mistral:latest");
  store = useStudioStore.getState();
  assert.equal(store.nodeLlmSettings.model, "mistral:latest");
});

test("node execution choose_best mode stores variants until a winner is selected", async () => {
  installProfileAwareMockNodeLlmClient();
  resetStudioStoreForTests(TREE_EVAL_FIXTURE_YAML);
  let store = useStudioStore.getState();

  store.setNodeLlmSettings({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3.2:latest",
    providerLabel: "ollama_openai",
  });
  const llamaProfileId = store.saveNodeLlmProfile({ name: "Local Llama" });
  store.setNodeLlmSettings({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "mistral:latest",
    providerLabel: "ollama_openai",
  });
  const mistralProfileId = useStudioStore.getState().saveNodeLlmProfile({ name: "Local Mistral" });

  useStudioStore.getState().setNodeModelAssignments("prompt_root_tree_eval", [llamaProfileId!, mistralProfileId!]);
  useStudioStore.getState().setNodeModelStrategy("prompt_root_tree_eval", { mode: "choose_best" });
  useStudioStore.getState().runNode("block:phase_1");
  await flushNodeRunQueue();

  store = useStudioStore.getState();
  assert.equal(store.nodeRuntimeStates.phase_1?.status, "success");
  assert.equal(store.nodeRuntimeStates.phase_1?.output, undefined);
  assert.equal(store.latestScopeOutputs["block:phase_1"]?.metadata?.executionMode, "choose_best");
  assert.equal((store.latestScopeOutputs["block:phase_1"]?.metadata?.variants as unknown[])?.length, 2);

  useStudioStore.getState().selectNodeModelWinner("phase_1", mistralProfileId!);
  store = useStudioStore.getState();
  assert.match(store.nodeRuntimeStates.phase_1?.output ?? "", /\[mistral:latest\]/);
  assert.equal(store.latestScopeOutputs["block:phase_1"]?.metadata?.selectedWinnerProfileId, mistralProfileId);
});

test("node execution merge mode uses the configured merge decider profile", async () => {
  installProfileAwareMockNodeLlmClient();
  resetStudioStoreForTests(TREE_EVAL_FIXTURE_YAML);
  let store = useStudioStore.getState();

  store.setNodeLlmSettings({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3.2:latest",
    providerLabel: "ollama_openai",
  });
  const llamaProfileId = store.saveNodeLlmProfile({ name: "Local Llama" });
  store.setNodeLlmSettings({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "mistral:latest",
    providerLabel: "ollama_openai",
  });
  const mistralProfileId = useStudioStore.getState().saveNodeLlmProfile({ name: "Local Mistral" });

  useStudioStore.getState().setNodeModelAssignments("prompt_root_tree_eval", [llamaProfileId!, mistralProfileId!]);
  useStudioStore.getState().setNodeModelStrategy("prompt_root_tree_eval", {
    mode: "merge",
    mergeProfileId: mistralProfileId!,
  });
  useStudioStore.getState().runNode("block:phase_1");
  await flushNodeRunQueue();

  store = useStudioStore.getState();
  assert.equal(store.nodeRuntimeStates.phase_1?.status, "success");
  assert.match(store.nodeRuntimeStates.phase_1?.output ?? "", /\[mistral:latest\]/);
  assert.equal(store.latestScopeOutputs["block:phase_1"]?.metadata?.executionMode, "merge");
  assert.equal(store.latestScopeOutputs["block:phase_1"]?.metadata?.mergeProfileId, mistralProfileId);
});

test("node llm connection smoke check reports success metadata", async () => {
  installMockNodeLlmClient();
  resetStudioStoreForTests(TREE_EVAL_FIXTURE_YAML);

  await useStudioStore.getState().testNodeLlmConnection();

  const store = useStudioStore.getState();
  assert.equal(store.nodeLlmProbe.status, "success");
  assert.equal(store.nodeLlmProbe.message, "Endpoint responded successfully.");
  assert.equal(store.nodeLlmProbe.provider, "mock");
  assert.equal(store.nodeLlmProbe.model, "mock-model");
  assert.equal(store.nodeLlmProbe.executionTimeMs, 12);
  assert.match(store.nodeLlmProbe.output ?? "", /Generated output:/);
});

test("message suggestion auto-applies the active dirty draft before requesting llm help", async () => {
  installMessageSuggestionAwareMockNodeLlmClient();
  resetStudioStoreForTests(TREE_EVAL_FIXTURE_YAML);
  let store = useStudioStore.getState();
  const promptNodeId = rootPromptSelectionId(store);

  store.setSelectedNodeId(promptNodeId);
  store = useStudioStore.getState();
  const activeEditorRef = store.activeEditorRef;
  assert.ok(activeEditorRef, "expected active editor ref");
  const draftSession = store.editorDrafts[activeEditorRef!];
  assert.ok(draftSession, "expected draft session");
  if (draftSession!.draft.entityKind !== "prompt") {
    throw new Error("expected prompt draft");
  }

  store.updateActiveEditorDraft({
    ...draftSession!.draft,
    title: "Fresh Tree Eval",
    description: "Fresh description from the dirty draft",
  });

  await useStudioStore.getState().suggestMessagesForActiveDraft();

  store = useStudioStore.getState();
  assert.equal(store.canonicalPrompt?.metadata.title, "Fresh Tree Eval");
  assert.equal(store.canonicalPrompt?.metadata.description, "Fresh description from the dirty draft");
  assert.equal(store.messageSuggestion.status, "success");
});

test("test and run selected node runs the current block after successful probe", async () => {
  installProfileAwareMockNodeLlmClient();
  resetStudioStoreForTests(TREE_EVAL_FIXTURE_YAML);
  let store = useStudioStore.getState();

  store.setNodeLlmSettings({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3.2:latest",
    providerLabel: "ollama_openai",
  });
  const profileId = store.saveNodeLlmProfile({ name: "Local Llama" });
  store.setNodeModelAssignments("prompt_root_tree_eval", [profileId!]);
  store.setSelectedNodeId("block:phase_1");
  await useStudioStore.getState().testNodeLlmConnectionAndRunSelectedNode();
  await flushNodeRunQueue();

  store = useStudioStore.getState();
  assert.equal(store.nodeLlmProbe.status, "success");
  assert.equal(store.nodeRuntimeStates.phase_1?.status, "success");
  assert.equal(store.nodeExecutionRecords.node_exec_1?.status, "success");
});

test("scope previews and outputs do not mutate canonicalPrompt", () => {
  resetStudioStoreForTests(TREE_EVAL_FIXTURE_YAML);
  const store = useStudioStore.getState();
  const before = JSON.stringify(store.canonicalPrompt);

  store.setSelectedNodeId("block:phase_1");
  store.refreshSelectedScopePromptPreview();
  store.runSelectedScopeRuntimeAction("resolve");

  const after = JSON.stringify(useStudioStore.getState().canonicalPrompt);
  assert.equal(after, before);
});

test("root editor draft can add evaluation spec and unblock evaluate", () => {
  resetStudioStoreForTests(TREE_FIXTURE_YAML);
  let store = useStudioStore.getState();
  const promptRef = rootPromptSelectionId(store);
  const promptDraft = store.editorDrafts[promptRef]?.draft;
  assert.ok(promptDraft && promptDraft.entityKind === "prompt", "expected prompt draft");

  store.updateActiveEditorDraft({
    ...promptDraft,
    evaluationEnabled: true,
    reviewerRolesJson: JSON.stringify([{ id: "manager" }], null, 2),
    criteriaJson: JSON.stringify(
      [
        {
          id: "correctness",
          title: "Correctness",
          weight: 1,
          maxScore: 5,
        },
      ],
      null,
      2,
    ),
    qualityGatesJson: JSON.stringify([{ metric: "overall", operator: ">=", threshold: 0 }], null, 2),
  });
  store.applyActiveEditorDraft();

  store = useStudioStore.getState();
  assert.equal(store.canonicalPrompt?.spec.evaluation?.reviewerRoles[0]?.id, "manager");

  store.runSelectedScopeRuntimeAction("evaluate");
  store = useStudioStore.getState();
  assert.equal(store.executionStatus, "success");
  assert.ok(store.runtimePreview.evaluation);
});

test("runtime actions execute from canonicalPrompt and update preview by stage", () => {
  resetStudioStoreForTests(RUNTIME_SUCCESS_FIXTURE_YAML);
  let store = useStudioStore.getState();

  store.runRuntimeAction("resolve");
  store = useStudioStore.getState();
  assert.equal(store.executionStatus, "success");
  assert.equal(store.lastRuntimeAction, "resolve");
  assert.ok(store.runtimePreview.context?.resolvedArtifact);
  assert.equal(store.runtimePreview.evaluation, undefined);

  store.runRuntimeAction("evaluate");
  store = useStudioStore.getState();
  assert.equal(store.executionStatus, "success");
  assert.ok(store.runtimePreview.evaluation);
  assert.equal(store.runtimePreview.blueprint, undefined);

  store.runRuntimeAction("blueprint");
  store = useStudioStore.getState();
  assert.equal(store.executionStatus, "success");
  assert.ok(store.runtimePreview.blueprint);
  assert.ok(store.runtimePreview.evaluation);

  store.runRuntimeAction("build");
  store = useStudioStore.getState();
  assert.equal(store.executionStatus, "success");
  assert.ok(store.runtimePreview.buildOutput);
});

test("runtime action failure is reported in execution state", () => {
  resetStudioStoreForTests(ROUNDTRIP_FIXTURE_YAML);
  const store = useStudioStore.getState();

  store.runRuntimeAction("resolve");
  const next = useStudioStore.getState();

  assert.equal(next.executionStatus, "failure");
  assert.equal(next.lastRuntimeAction, "resolve");
  assert.ok(next.runtimePreview.issues.length > 0);
  assert.ok(next.runtimeErrorSummary);
});

test("runtime actions do not bypass canonicalPrompt even if graph is mutated", () => {
  resetStudioStoreForTests(RUNTIME_SUCCESS_FIXTURE_YAML);
  const initialState = useStudioStore.getState();
  assert.ok(initialState.canonicalPrompt, "expected canonical prompt");
  const canonicalArtifactType = initialState.canonicalPrompt.spec.artifact.type;

  useStudioStore.setState(() => ({
    nodes: [],
    edges: [],
  }));

  useStudioStore.getState().runRuntimeAction("resolve");
  const next = useStudioStore.getState();
  assert.equal(next.executionStatus, "success");
  assert.equal(next.runtimePreview.context?.resolvedArtifact.artifactType, canonicalArtifactType);
});

test("load -> edit -> save preserves nested prompt blocks", () => {
  resetStudioStoreForTests(TREE_FIXTURE_YAML);
  const store = useStudioStore.getState();
  assert.ok(store.canonicalPrompt, "expected canonical prompt");
  assert.equal(store.canonicalPrompt.spec.blocks.length, 1);
  assert.equal(store.canonicalPrompt.spec.blocks[0]?.children.length, 1);

  store.applyGraphIntent({
    type: "block.patch",
    blockId: "chapter_1",
    changes: {
      title: "Chapter 1 Updated",
      description: "Updated chapter summary",
    },
  });

  const saved = useStudioStore.getState().savePrompt();
  assert.ok(saved, "expected save result");
  const parsed = PromptSchema.parse(YAML.parse(saved.yamlText));

  assert.equal(parsed.spec.blocks[0]?.title, "Chapter 1 Updated");
  assert.equal(parsed.spec.blocks[0]?.description, "Updated chapter summary");
  assert.equal(parsed.spec.blocks[0]?.children[0]?.id, "section_1");
  assert.deepEqual(parsed.spec.buildTargets[0]?.options, { lineWidth: 72 });
});

test("block intents support add, focus, nested message edits, move, and remove", () => {
  resetStudioStoreForTests(TREE_FIXTURE_YAML);
  let store = useStudioStore.getState();

  store.focusBlock("chapter_1");
  store = useStudioStore.getState();
  assert.equal(store.focusedBlockId, "chapter_1");
  assert.equal(store.nodes.some((node) => node.data.kind === "block" && node.data.properties.blockId === "section_1"), true);

  store.applyGraphIntent({
    type: "block.add",
    kind: "section",
    parentBlockId: "chapter_1",
  });

  store = useStudioStore.getState();
  const chapter = store.canonicalPrompt?.spec.blocks[0];
  assert.ok(chapter, "expected chapter block");
  assert.equal(chapter.children.length, 2);

  store.applyGraphIntent({
    type: "block.patch",
    blockId: "chapter_1",
    changes: {
      messages: [
        {
          role: "user",
          content: "Updated chapter prompt",
        },
      ],
    },
  });

  store = useStudioStore.getState();
  assert.equal(store.canonicalPrompt?.spec.blocks[0]?.messages[0]?.content, "Updated chapter prompt");

  const addedChildId = store.canonicalPrompt?.spec.blocks[0]?.children[1]?.id;
  assert.ok(addedChildId, "expected added child id");
  store.applyGraphIntent({
    type: "block.move",
    blockId: addedChildId,
    direction: "up",
  });

  store = useStudioStore.getState();
  assert.equal(store.canonicalPrompt?.spec.blocks[0]?.children[0]?.id, addedChildId);

  store.applyGraphIntent({
    type: "block.remove",
    blockId: addedChildId,
  });

  store = useStudioStore.getState();
  assert.equal(store.canonicalPrompt?.spec.blocks[0]?.children.some((block: { id: string }) => block.id === addedChildId), false);
});

test("root runtime actions remain compatible when prompt tree blocks are present", () => {
  resetStudioStoreForTests(TREE_FIXTURE_YAML);
  const store = useStudioStore.getState();

  store.runRuntimeAction("resolve");
  const next = useStudioStore.getState();

  assert.equal(next.executionStatus, "success");
  assert.equal(next.runtimePreview.context?.sourcePrompt.spec.blocks.length, 1);
  assert.equal(next.runtimePreview.context?.resolvedArtifact.artifactType, "book_text");
});

test("focused block runtime actions run in block scope without breaking root runtime model", () => {
  resetStudioStoreForTests(TREE_EVAL_FIXTURE_YAML);
  let store = useStudioStore.getState();
  store.focusBlock("phase_1");

  store = useStudioStore.getState();
  store.runFocusedBlockRuntimeAction("resolve");
  store = useStudioStore.getState();

  assert.equal(store.executionStatus, "success");
  assert.equal(store.runtimePreview.scope?.mode, "block");
  assert.equal(store.runtimePreview.scope?.blockId, "phase_1");
  assert.equal(store.runtimePreview.context?.sourcePrompt.metadata.id, "tree_eval_phase_1");
  assert.equal(store.runtimePreview.context?.sourcePrompt.spec.buildTargets.length, 0);

  store.runFocusedBlockRuntimeAction("evaluate");
  store = useStudioStore.getState();
  assert.equal(store.executionStatus, "success");
  assert.ok(store.runtimePreview.evaluation);

  store.runFocusedBlockRuntimeAction("blueprint");
  store = useStudioStore.getState();
  assert.equal(store.executionStatus, "success");
  assert.ok(store.runtimePreview.blueprint);
});

test("node execution supports root and block runs without wiping runtime state on edit", async () => {
  installMockNodeLlmClient();
  resetStudioStoreForTests(TREE_EVAL_FIXTURE_YAML);
  let store = useStudioStore.getState();

  store.setNodeLlmSettings({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3.2:latest",
    providerLabel: "ollama_openai",
  });
  const profileId = store.saveNodeLlmProfile({ name: "Local Llama" });
  store.setNodeModelAssignments("prompt_root_tree_eval", [profileId!]);

  store.runNode(rootPromptSelectionId(store));
  assert.equal(useStudioStore.getState().nodeRuntimeStates.prompt_root_tree_eval?.status, "running");
  await flushNodeRunQueue();

  store = useStudioStore.getState();
  assert.equal(store.nodeRuntimeStates.prompt_root_tree_eval?.status, "success");
  assert.equal(Object.keys(store.nodeExecutionRecords).length, 1);
  assert.equal(store.nodeExecutionRecords.node_exec_1?.status, "success");
  assert.equal(store.nodeExecutionRecords.node_exec_1?.provider, "mock");

  store.runNode("block:phase_1");
  assert.equal(useStudioStore.getState().nodeRuntimeStates.phase_1?.status, "running");
  await flushNodeRunQueue();

  store = useStudioStore.getState();
  assert.equal(store.nodeRuntimeStates.phase_1?.status, "success");
  assert.equal(store.nodeExecutionRecords.node_exec_2?.status, "success");
  assert.equal(store.nodeExecutionRecords.node_exec_2?.model, "mock-model");
  assert.ok(store.nodeRuntimeStates.phase_1?.output?.includes("Plan the implementation phase."));
  assert.equal(store.latestScopeOutputs["block:phase_1"]?.action, "resolve");
  assert.equal(store.latestScopeOutputs["block:phase_1"]?.contentType, "generated_output");
  assert.equal(store.latestScopeOutputs["block:phase_1"]?.metadata?.provider, "mock");
  assert.equal(store.latestScopeOutputs["block:phase_1"]?.metadata?.model, "mock-model");

  store.applyGraphIntent({
    type: "block.patch",
    blockId: "phase_1",
    changes: {
      title: "Phase 1 Updated",
    },
  });

  store = useStudioStore.getState();
  assert.equal(store.nodeRuntimeStates.prompt_root_tree_eval?.status, "stale");
  assert.equal(store.nodeRuntimeStates.phase_1?.status, "stale");
  assert.equal(store.nodeExecutionRecords.node_exec_1?.status, "success");
  assert.equal(store.nodeExecutionRecords.node_exec_2?.status, "success");
});

test("node execution stop cancels queued runs before resolve completes", async () => {
  installMockNodeLlmClient();
  resetStudioStoreForTests(TREE_EVAL_FIXTURE_YAML);
  const store = useStudioStore.getState();

  store.setNodeLlmSettings({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3.2:latest",
    providerLabel: "ollama_openai",
  });
  const profileId = store.saveNodeLlmProfile({ name: "Local Llama" });
  store.setNodeModelAssignments("prompt_root_tree_eval", [profileId!]);

  store.runNode("block:phase_1");
  assert.equal(useStudioStore.getState().nodeRuntimeStates.phase_1?.status, "running");

  useStudioStore.getState().stopNode("block:phase_1");
  await flushNodeRunQueue();

  const next = useStudioStore.getState();
  assert.equal(next.nodeRuntimeStates.phase_1?.status, "idle");
  assert.equal(next.nodeRuntimeStates.phase_1?.lastRunAt, undefined);
  assert.equal(next.nodeExecutionRecords.node_exec_1?.status, "cancelled");
  assert.ok(next.nodeExecutionRecords.node_exec_1?.cancelRequestedAt);
});

test("graph proposal generation stores preview proposal and history", async () => {
  installGraphProposalAwareMockNodeLlmClient();
  resetStudioStoreForTests(TREE_FIXTURE_YAML);
  let store = useStudioStore.getState();

  store.setNodeLlmSettings({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3.2:latest",
    providerLabel: "ollama_openai",
  });
  const profileId = store.saveNodeLlmProfile({ name: "Local Llama" });
  store.setNodeModelAssignments("prompt_root_tree_book", [profileId!]);

  store.generateNodeGraphProposal(rootPromptSelectionId(store));
  await flushNodeRunQueue();

  store = useStudioStore.getState();
  const proposal = Object.values(store.graphProposals)[0];
  assert.ok(proposal, "expected graph proposal");
  assert.equal(proposal.status, "preview");
  assert.equal(proposal.summary, "Add one proposed chapter");
  assert.equal(store.latestScopeOutputs["root:tree_book"]?.contentType, "graph_proposal");
  assert.equal(store.nodeResultHistory.prompt_root_tree_book?.length, 1);
  assert.equal(store.nodeResultHistory.prompt_root_tree_book?.[0]?.resultKind, "graph_proposal");
  assert.ok(store.selectedProposalNodeId);
});

test("graph proposal generation retries once when the first response does not match the structure contract", async () => {
  installRetryingGraphProposalMockNodeLlmClient();
  resetStudioStoreForTests(TREE_FIXTURE_YAML);
  let store = useStudioStore.getState();

  store.setNodeLlmSettings({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3.2:latest",
    providerLabel: "ollama_openai",
  });
  const profileId = store.saveNodeLlmProfile({ name: "Local Llama" });
  store.setNodeModelAssignments("prompt_root_tree_book", [profileId!]);

  store.generateNodeGraphProposal(rootPromptSelectionId(store));
  await flushNodeRunQueue();

  store = useStudioStore.getState();
  const proposal = Object.values(store.graphProposals)[0];
  assert.ok(proposal, "expected graph proposal after retry");
  assert.equal(proposal.summary, "Recovered structure");
  assert.equal(proposal.blocks[0]?.title, "Recovered Chapter");
  assert.ok(
    store.consoleEvents.some(
      (event) => event.category === "structure" && /Retrying \(2\/2\)/i.test(event.message),
    ),
  );
});

test("text generation logs a warning when preview structure proposals are still unapplied", async () => {
  installGraphProposalAwareMockNodeLlmClient();
  resetStudioStoreForTests(TREE_FIXTURE_YAML);
  let store = useStudioStore.getState();

  store.setNodeLlmSettings({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3.2:latest",
    providerLabel: "ollama_openai",
  });
  const profileId = store.saveNodeLlmProfile({ name: "Local Llama" });
  store.setNodeModelAssignments("prompt_root_tree_book", [profileId!]);

  store.generateNodeGraphProposal(rootPromptSelectionId(store));
  await flushNodeRunQueue();

  store = useStudioStore.getState();
  assert.equal(Object.values(store.graphProposals).length, 1);

  store.runNode(rootPromptSelectionId(store));
  await flushNodeRunQueue();

  store = useStudioStore.getState();
  assert.equal(store.nodeRuntimeStates.prompt_root_tree_book?.status, "success");
  assert.equal(store.latestScopeOutputs["root:tree_book"]?.contentType, "generated_output");
  assert.ok(
    store.consoleEvents.some(
      (event) =>
        event.category === "system" &&
        event.nodeId === "prompt_root_tree_book" &&
        /unapplied structure proposal/i.test(event.message),
    ),
  );
});

test("graph proposal generation auto-applies the active dirty draft before execution", async () => {
  installGraphProposalAwareMockNodeLlmClient();
  resetStudioStoreForTests(TREE_FIXTURE_YAML);
  let store = useStudioStore.getState();
  const promptNodeId = rootPromptSelectionId(store);

  store.setSelectedNodeId(promptNodeId);
  store = useStudioStore.getState();
  const activeEditorRef = store.activeEditorRef;
  assert.ok(activeEditorRef, "expected active editor ref");
  const draftSession = store.editorDrafts[activeEditorRef!];
  assert.ok(draftSession, "expected draft session");
  if (draftSession!.draft.entityKind !== "prompt") {
    throw new Error("expected prompt draft");
  }

  store.updateActiveEditorDraft({
    ...draftSession!.draft,
    title: "Fresh Tree Book",
    description: "Fresh draft description before proposal generation",
  });

  store.generateNodeGraphProposal(promptNodeId);
  await flushNodeRunQueue();

  store = useStudioStore.getState();
  assert.equal(store.canonicalPrompt?.metadata.title, "Fresh Tree Book");
  assert.equal(store.canonicalPrompt?.metadata.description, "Fresh draft description before proposal generation");
  assert.ok(Object.values(store.graphProposals)[0], "expected graph proposal");
});

test("graph proposal generation tolerates trailing commas in model JSON", async () => {
  installMalformedGraphProposalMockNodeLlmClient();
  resetStudioStoreForTests(TREE_FIXTURE_YAML);
  let store = useStudioStore.getState();

  store.setNodeLlmSettings({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3.2:latest",
    providerLabel: "ollama_openai",
  });
  const profileId = store.saveNodeLlmProfile({ name: "Local Llama" });
  store.setNodeModelAssignments("prompt_root_tree_book", [profileId!]);

  store.generateNodeGraphProposal(rootPromptSelectionId(store));
  await flushNodeRunQueue();

  store = useStudioStore.getState();
  const proposal = Object.values(store.graphProposals)[0];
  assert.ok(proposal, "expected graph proposal");
  assert.equal(proposal.blocks[0]?.title, "Loose JSON Chapter");
});

test("graph proposal parser can recover from a truncated json tail", () => {
  const prompt = PromptSchema.parse(YAML.parse(TREE_FIXTURE_YAML));
  const proposal = createGraphProposalFromResponse({
    prompt,
    scope: {
      scopeRef: "root:tree_book",
      mode: "root",
      label: "Tree Book",
    },
    sourceNodeId: "prompt:tree_book",
    sourceRuntimeNodeId: "prompt_root_tree_book",
    proposalId: "graph_proposal_truncated_json_test",
    executionId: "node_exec_truncated_json_test",
    responseText:
      '{"summary":"Recovered outline","blocks":[{"kind":"chapter","title":"Understanding Habits and Burnout","description":"A real chapter","instruction":"","children":[]},{"kind":"chapter","title":"Building Resilient Habits","description":"Another chapter","instruction":"","children":[]}',
  });

  assert.equal(proposal.summary, "Recovered outline");
  assert.equal(proposal.blocks.length, 2);
  assert.equal(proposal.blocks[1]?.title, "Building Resilient Habits");
});

test("graph proposal parser can recover completed blocks from a mid-block truncation", () => {
  const prompt = PromptSchema.parse(YAML.parse(TREE_FIXTURE_YAML));
  const proposal = createGraphProposalFromResponse({
    prompt,
    scope: {
      scopeRef: "root:tree_book",
      mode: "root",
      label: "Tree Book",
    },
    sourceNodeId: "prompt:tree_book",
    sourceRuntimeNodeId: "prompt_root_tree_book",
    proposalId: "graph_proposal_partial_blocks_test",
    executionId: "node_exec_partial_blocks_test",
    responseText:
      '{\n  "summary": "Habits Without Burnout",\n  "blocks": [\n    {\n      "kind": "chapter",\n      "title": "Understanding Habits and Burnout",\n      "description": "Exploring the relationship between habits and burnout, including signs, causes, and consequences.",\n      "instruction": "",\n      "children": []\n    },\n    {\n      "kind": "chapter",\n      "title": "Building Resilient Habits",\n      "descri',
  });

  assert.equal(proposal.summary, "Habits Without Burnout");
  assert.equal(proposal.blocks.length, 1);
  assert.equal(proposal.blocks[0]?.title, "Understanding Habits and Burnout");
});

test("book root proposal prompt prefers chapter structure over metadata blocks", () => {
  const prompt = PromptSchema.parse(YAML.parse(TREE_FIXTURE_YAML));
  const instruction = buildGraphProposalInstruction({
    prompt,
    scope: {
      scopeRef: "root:tree_book",
      mode: "root",
      label: "Tree Book",
    },
  });
  const userPrompt = buildGraphProposalUserPrompt({
    prompt,
    scope: {
      scopeRef: "root:tree_book",
      mode: "root",
      label: "Tree Book",
    },
    renderedPromptText: "Create a practical non-fiction book about habit building for beginners.",
  });

  assert.match(instruction, /table-of-contents style proposal made of chapter blocks/i);
  assert.match(instruction, /Do not create blocks such as genre, audience, tone, or goals/i);
  assert.match(userPrompt, /chapter blocks/i);
});

test("book root proposal adds warnings for shallow or metadata-like outlines", () => {
  const prompt = PromptSchema.parse(YAML.parse(TREE_FIXTURE_YAML));
  const proposal = createGraphProposalFromResponse({
    prompt,
    scope: {
      scopeRef: "root:tree_book",
      mode: "root",
      label: "Tree Book",
    },
    sourceNodeId: "prompt:tree_book",
    sourceRuntimeNodeId: "prompt_root_tree_book",
    proposalId: "graph_proposal_warning_test",
    executionId: "node_exec_warning_test",
    responseText: JSON.stringify({
      summary: "Sparse outline",
      blocks: [
        {
          kind: "chapter",
          title: "Genre",
          description: "Metadata-like chapter",
          instruction: "Describe the genre.",
          children: [],
        },
        {
          kind: "chapter",
          title: "Audience",
          description: "Metadata-like audience block",
          instruction: "Describe the audience.",
          children: [],
        },
      ],
    }),
  });

  assert.ok(proposal.warnings?.some((warning) => /shallow/i.test(warning)));
  assert.ok(proposal.warnings?.some((warning) => /metadata/i.test(warning)));
});

test("book chapter proposal normalizes heading-like kinds to section", () => {
  const prompt = PromptSchema.parse(YAML.parse(TREE_FIXTURE_YAML));
  const proposal = createGraphProposalFromResponse({
    prompt,
    scope: {
      scopeRef: "block:chapter_1",
      mode: "block",
      blockId: "chapter_1",
      blockPath: ["Chapter 1"],
      label: "Chapter 1",
    },
    sourceNodeId: "block:chapter_1",
    sourceRuntimeNodeId: "chapter_1",
    proposalId: "graph_proposal_test",
    executionId: "node_exec_test",
    responseText: JSON.stringify({
      summary: "Propose sections",
      blocks: [
        {
          kind: "heading",
          title: "Why habits fail",
          description: "Explain the main reasons habits break down.",
          instruction: "Draft this section with practical examples.",
          children: [],
        },
      ],
    }),
  });

  assert.equal(proposal.blocks[0]?.kind, "section");
});

test("book proposal normalizes generic block kind to the allowed structural kind", () => {
  const prompt = PromptSchema.parse(YAML.parse(TREE_FIXTURE_YAML));

  const chapterChildProposal = createGraphProposalFromResponse({
    prompt,
    scope: {
      scopeRef: "block:chapter_1",
      mode: "block",
      blockId: "chapter_1",
      blockPath: ["Chapter 1"],
      label: "Chapter 1",
    },
    sourceNodeId: "block:chapter_1",
    sourceRuntimeNodeId: "chapter_1",
    proposalId: "graph_proposal_block_alias_section_test",
    executionId: "node_exec_block_alias_section_test",
    responseText: JSON.stringify({
      summary: "Propose sections",
      blocks: [
        {
          kind: "block",
          title: "Recovery loop",
          description: "Explain how to recover after a bad week.",
          instruction: "Draft a section with practical advice.",
          children: [],
        },
      ],
    }),
  });

  const rootProposal = createGraphProposalFromResponse({
    prompt,
    scope: {
      scopeRef: "root:tree_book",
      mode: "root",
      label: "Tree Book",
    },
    sourceNodeId: "prompt:tree_book",
    sourceRuntimeNodeId: "prompt_root_tree_book",
    proposalId: "graph_proposal_block_alias_chapter_test",
    executionId: "node_exec_block_alias_chapter_test",
    responseText: JSON.stringify({
      summary: "Propose chapters",
      blocks: [
        {
          kind: "block",
          title: "Resetting after burnout",
          description: "Introduce the chapter topic.",
          instruction: "Draft a chapter introduction.",
          children: [],
        },
      ],
    }),
  });

  assert.equal(chapterChildProposal.blocks[0]?.kind, "section");
  assert.equal(rootProposal.blocks[0]?.kind, "chapter");
});

test("book chapter proposal normalizes paragraph-like children to section with fallback title", () => {
  const prompt = PromptSchema.parse(YAML.parse(TREE_FIXTURE_YAML));
  const proposal = createGraphProposalFromResponse({
    prompt,
    scope: {
      scopeRef: "root:tree_book",
      mode: "root",
      label: "Tree Book",
    },
    sourceNodeId: "prompt:tree_book",
    sourceRuntimeNodeId: "prompt_root_tree_book",
    proposalId: "graph_proposal_paragraph_child_test",
    executionId: "node_exec_paragraph_child_test",
    responseText: JSON.stringify({
      summary: "Propose chapters with loose nested content",
      blocks: [
        {
          kind: "chapter",
          title: "Why habits fail",
          description: "Explain the chapter goal.",
          children: [
            {
              kind: "paragraph",
              text: "Common triggers that break consistency and create burnout loops.",
            },
          ],
        },
      ],
    }),
  });

  assert.equal(proposal.blocks[0]?.children[0]?.kind, "section");
  assert.match(proposal.blocks[0]?.children[0]?.title ?? "", /Common triggers/);
});

test("book root proposal accepts chapters key instead of blocks", () => {
  const prompt = PromptSchema.parse(YAML.parse(TREE_FIXTURE_YAML));
  const proposal = createGraphProposalFromResponse({
    prompt,
    scope: {
      scopeRef: "root:tree_book",
      mode: "root",
      label: "Tree Book",
    },
    sourceNodeId: "prompt:tree_book",
    sourceRuntimeNodeId: "prompt_root_tree_book",
    proposalId: "graph_proposal_root_test",
    executionId: "node_exec_root_test",
    responseText: JSON.stringify({
      summary: "Propose chapters",
      chapters: [
        {
          title: "Why habits fail",
          description: "Explain the main reasons habits break down.",
          instruction: "Draft the chapter with practical explanations.",
          children: [],
        },
      ],
    }),
  });

  assert.equal(proposal.blocks[0]?.kind, "chapter");
  assert.equal(proposal.blocks[0]?.title, "Why habits fail");
});

test("book root proposal accepts user children payload shape", () => {
  const prompt = PromptSchema.parse(YAML.parse(TREE_FIXTURE_YAML));
  const proposal = createGraphProposalFromResponse({
    prompt,
    scope: {
      scopeRef: "root:tree_book",
      mode: "root",
      label: "Tree Book",
    },
    sourceNodeId: "prompt:tree_book",
    sourceRuntimeNodeId: "prompt_root_tree_book",
    proposalId: "graph_proposal_user_children_test",
    executionId: "node_exec_user_children_test",
    responseText: JSON.stringify({
      id: "TreeBook",
      version: "1.0.0",
      system: {
        title: "Table of Contents",
      },
      user: {
        title: "Chapter Blocks for Tree Book",
        kind: "book_text",
        children: [
          {
            id: "why_habits_fail",
            title: "Why Habits Fail",
            description: "Explain the main reasons habits break down.",
            instruction: "Draft the chapter with practical explanations.",
            children: [],
          },
        ],
      },
    }),
  });

  assert.equal(proposal.blocks[0]?.kind, "chapter");
  assert.equal(proposal.blocks[0]?.title, "Why Habits Fail");
});

test("book root proposal accepts singular chapter key and ignores paragraph children", () => {
  const prompt = PromptSchema.parse(YAML.parse(TREE_FIXTURE_YAML));
  const proposal = createGraphProposalFromResponse({
    prompt,
    scope: {
      scopeRef: "root:tree_book",
      mode: "root",
      label: "Tree Book",
    },
    sourceNodeId: "prompt:tree_book",
    sourceRuntimeNodeId: "prompt_root_tree_book",
    proposalId: "graph_proposal_singular_chapter_test",
    executionId: "node_exec_singular_chapter_test",
    responseText: JSON.stringify({
      chapter: [
        {
          kind: "book_text",
          title: "Putting It All Together",
          description: "A summary chapter.",
          instruction: null,
          children: [
            {
              type: "paragraph",
              text: "This is content, not a structural child block.",
            },
          ],
        },
      ],
    }),
  });

  assert.equal(proposal.blocks[0]?.kind, "chapter");
  assert.equal(proposal.blocks[0]?.title, "Putting It All Together");
  assert.equal(proposal.blocks[0]?.children.length, 0);
});

test("applying graph proposal creates canonical blocks through graph intents", async () => {
  installGraphProposalAwareMockNodeLlmClient();
  resetStudioStoreForTests(TREE_FIXTURE_YAML);
  let store = useStudioStore.getState();

  store.setNodeLlmSettings({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3.2:latest",
    providerLabel: "ollama_openai",
  });
  const profileId = store.saveNodeLlmProfile({ name: "Local Llama" });
  store.setNodeModelAssignments("prompt_root_tree_book", [profileId!]);

  store.generateNodeGraphProposal(rootPromptSelectionId(store));
  await flushNodeRunQueue();

  store = useStudioStore.getState();
  const proposalId = Object.values(store.graphProposals)[0]?.proposalId;
  assert.ok(proposalId, "expected proposal id");

  store.applyGraphProposal(proposalId!);
  store = useStudioStore.getState();

  assert.equal(store.canonicalPrompt?.spec.blocks.some((block) => block.title === "Proposed Chapter"), true);
  assert.equal(store.graphProposals[proposalId!]?.status, "applied");
});

test("node result history can restore an earlier text result after proposal generation", async () => {
  installGraphProposalAwareMockNodeLlmClient();
  resetStudioStoreForTests(TREE_FIXTURE_YAML);
  let store = useStudioStore.getState();

  store.setNodeLlmSettings({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3.2:latest",
    providerLabel: "ollama_openai",
  });
  const profileId = store.saveNodeLlmProfile({ name: "Local Llama" });
  store.setNodeModelAssignments("prompt_root_tree_book", [profileId!]);

  store.runNode(rootPromptSelectionId(store));
  await flushNodeRunQueue();
  store.generateNodeGraphProposal(rootPromptSelectionId(store));
  await flushNodeRunQueue();

  store = useStudioStore.getState();
  const textEntry = store.nodeResultHistory.prompt_root_tree_book?.find((entry) => entry.resultKind === "text_result");
  assert.ok(textEntry, "expected text history entry");

  store.restoreNodeResultHistoryEntry("prompt_root_tree_book", textEntry!.historyEntryId);
  store = useStudioStore.getState();

  assert.equal(store.latestScopeOutputs["root:tree_book"]?.contentType, "generated_output");
  assert.match(String(store.latestScopeOutputs["root:tree_book"]?.content ?? ""), /Generated output:/);
});

test("studio runtime state persists graph proposals, history, and execution records across reload", async () => {
  const persistence = createInMemoryStudioPersistenceAdapter();
  try {
    setStudioPersistenceAdapterForTests(persistence);

    installGraphProposalAwareMockNodeLlmClient();
    resetStudioStoreForTests(TREE_FIXTURE_YAML);
    let store = useStudioStore.getState();

    store.setNodeLlmSettings({
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
      model: "llama3.2:latest",
      providerLabel: "ollama_openai",
    });
    const profileId = store.saveNodeLlmProfile({ name: "Local Llama" });
    store.setNodeModelAssignments("prompt_root_tree_book", [profileId!]);

    store.runNode(rootPromptSelectionId(store));
    await flushNodeRunQueue();
    store.generateNodeGraphProposal(rootPromptSelectionId(store));
    await flushNodeRunQueue();

    resetStudioStoreForTests(TREE_FIXTURE_YAML);
    store = useStudioStore.getState();

    assert.equal(Object.values(store.graphProposals).length, 1);
    assert.equal(store.nodeResultHistory.prompt_root_tree_book?.length, 2);
    assert.equal(store.nodeExecutionRecords.node_exec_1?.status, "success");
    assert.equal(store.nodeExecutionRecords.node_exec_2?.status, "success");
    assert.equal(store.nodeRuntimeStates.prompt_root_tree_book?.status, "success");
    assert.equal(store.latestScopeOutputs["root:tree_book"]?.contentType, "graph_proposal");

    store.generateNodeGraphProposal(rootPromptSelectionId(store));
    await flushNodeRunQueue();
    store = useStudioStore.getState();

    assert.ok(store.nodeExecutionRecords.node_exec_3);
    assert.ok(store.graphProposals.graph_proposal_2);
  } finally {
    persistence.clear();
    setStudioPersistenceAdapterForTests(undefined);
  }
});

test("remote runtime recovery reattaches active execution and restores final output after reload", async () => {
  const persistence = createInMemoryStudioPersistenceAdapter();

  try {
    setStudioPersistenceAdapterForTests(persistence);
    setStudioExecutionRemoteConfigForTests({
      mode: "http",
      baseUrl: "http://promptfarm.test",
    });

    resetStudioStoreForTests(TREE_FIXTURE_YAML);
    let store = useStudioStore.getState();
    const prompt = store.canonicalPrompt!;
    const runtimeNodeId = `prompt_root_${prompt.metadata.id}`;
    const executionRecord = createNodeExecutionRecord({
      executionId: "node_exec_1",
      promptId: prompt.metadata.id,
      nodeId: runtimeNodeId,
      scope: { mode: "root" },
      mode: "text",
      sourceSnapshotHash: "snapshot_hash_1",
      startedAt: new Date("2026-03-15T10:00:00.000Z"),
    });

    useStudioStore.setState({
      nodeRuntimeStates: {
        ...store.nodeRuntimeStates,
        [runtimeNodeId]: {
          ...store.nodeRuntimeStates[runtimeNodeId],
          status: "running",
          activeExecutionId: executionRecord.executionId,
          startedAt: executionRecord.startedAt,
          upstreamSnapshotHash: executionRecord.sourceSnapshotHash,
        },
      },
      nodeExecutionRecords: {
        ...store.nodeExecutionRecords,
        [executionRecord.executionId]: executionRecord,
      },
    });

    setStudioExecutionRemoteTransportForTests(async ({ url }) => {
      if (url.endsWith(`/api/studio/persistence/prompts/${prompt.metadata.id}/runtime`)) {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          async json() {
            return { error: "not found" };
          },
          async text() {
            return "not found";
          },
        };
      }

      if (url.endsWith(`/api/studio/executions/${executionRecord.executionId}`)) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async json() {
            return {
              record: {
                ...executionRecord,
                status: "success",
                output: "Recovered server output",
                provider: "ollama_openai",
                model: "llama3.2:latest",
                executionTimeMs: 42,
                completedAt: new Date("2026-03-15T10:00:01.000Z"),
              },
            };
          },
          async text() {
            return "";
          },
        };
      }

      throw new Error(`Unexpected remote url: ${url}`);
    });

    await useStudioStore.getState().recoverRemoteRuntimeForCurrentPrompt();
    store = useStudioStore.getState();

    assert.equal(store.nodeExecutionRecords.node_exec_1?.status, "success");
    assert.equal(store.nodeRuntimeStates[runtimeNodeId]?.status, "success");
    assert.equal(store.latestScopeOutputs[`root:${prompt.metadata.id}`]?.contentType, "generated_output");
    assert.equal(store.latestScopeOutputs[`root:${prompt.metadata.id}`]?.content, "Recovered server output");
    assert.equal(store.nodeResultHistory[runtimeNodeId]?.[0]?.executionId, "node_exec_1");
  } finally {
    persistence.clear();
    setStudioExecutionRemoteTransportForTests(undefined);
    setStudioExecutionRemoteConfigForTests(undefined);
    setStudioPersistenceAdapterForTests(undefined);
  }
});
