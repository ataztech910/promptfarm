import assert from "node:assert/strict";
import test from "node:test";
import { PromptSchema } from "@promptfarm/core";
import YAML from "yaml";
import { resetStudioStoreForTests, useStudioStore } from "./studioStore";

function rootPromptSelectionId(store: ReturnType<typeof useStudioStore.getState>): string {
  if (!store.canonicalPrompt) {
    throw new Error("Expected canonical prompt");
  }
  return `prompt:${store.canonicalPrompt.metadata.id}`;
}

async function flushNodeRunQueue(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
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
  resetStudioStoreForTests(TREE_EVAL_FIXTURE_YAML);
  let store = useStudioStore.getState();

  store.runNode(rootPromptSelectionId(store));
  assert.equal(useStudioStore.getState().nodeRuntimeStates.prompt_root_tree_eval?.status, "running");
  await flushNodeRunQueue();

  store = useStudioStore.getState();
  assert.equal(store.nodeRuntimeStates.prompt_root_tree_eval?.status, "success");
  assert.equal(Object.keys(store.nodeExecutionRecords).length, 1);
  assert.equal(store.nodeExecutionRecords.node_exec_1?.status, "success");

  store.runNode("block:phase_1");
  assert.equal(useStudioStore.getState().nodeRuntimeStates.phase_1?.status, "running");
  await flushNodeRunQueue();

  store = useStudioStore.getState();
  assert.equal(store.nodeRuntimeStates.phase_1?.status, "success");
  assert.equal(store.nodeExecutionRecords.node_exec_2?.status, "success");
  assert.ok(store.nodeRuntimeStates.phase_1?.output?.includes("Plan the implementation phase."));
  assert.equal(store.latestScopeOutputs["block:phase_1"]?.action, "resolve");

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
  resetStudioStoreForTests(TREE_EVAL_FIXTURE_YAML);
  const store = useStudioStore.getState();

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
