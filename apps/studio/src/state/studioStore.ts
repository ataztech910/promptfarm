import { applyEdgeChanges, applyNodeChanges, type EdgeChange, type NodeChange } from "@xyflow/react";
import {
  cancelNodeExecutionRecord,
  completeNodeExecutionRecord,
  createInMemoryNodeExecutionRepository,
  createNodeExecutionRecord,
  requestNodeExecutionCancellation,
  type NodeExecutionRepository,
  type NodeExecutionRecord,
  type NodeRuntimeState,
  type Prompt,
  type PromptBlock,
} from "@promptfarm/core";
import YAML from "yaml";
import { create } from "zustand";
import { createStarterPrompt, type StarterArtifactChoice } from "../editor/goldenPath";
import { canonicalPromptToGraph } from "../graph/adapters/canonicalToGraph";
import { applyGraphIntentToPrompt } from "../graph/adapters/graphSync";
import {
  createEditorDraftSession,
  getDraftHash,
  parseEvaluationDraft,
  parseInputDrafts,
  resolveEditorSelection,
  resolveSelectionByRef,
  type EditorDraft,
  type EditorDraftSession,
  type EditorSelection,
} from "../inspector/editorSession";
import type {
  BlockEditIntent,
  GraphAddableNodeKind,
  GraphEditIntent,
  StudioFlowEdge,
  StudioFlowNode,
  StudioNodeKind,
  StudioPromptUnitOutput,
  StudioRuntimeAction,
  StudioRuntimeExecutionStatus,
  StudioRenderedPromptPreview,
  StudioRuntimePreview,
} from "../graph/types";
import { SAMPLE_PROMPT_YAML } from "../model/samplePromptYaml";
import {
  createRuntimePreviewFromPrompt,
  createRuntimePreviewFromYaml,
  type StudioRuntimeExecutionScope,
  executeRuntimeActionFromPrompt,
  executeRuntimeActionFromPromptAsync,
} from "../runtime/createRuntimePreview";
import {
  createPromptUnitOutput,
  createRenderedPromptPreview,
  resolveSelectedStudioScope,
} from "../runtime/scopeRuntime";

type StudioState = {
  canonicalPrompt: Prompt | null;
  savedPrompt: Prompt | null;
  savedPromptDigest: string | null;
  sourceLabel: string;
  paletteFocusKind: StudioNodeKind | null;
  focusedBlockId: string | null;
  collapsedBlockIds: string[];

  yamlText: string;
  importError: string | null;
  syncIssues: string[];
  isDirty: boolean;
  hasYamlDraftChanges: boolean;
  lastSavedAt: number | null;
  runtimeRefreshedAt: number | null;

  executionStatus: StudioRuntimeExecutionStatus;
  lastRuntimeAction?: StudioRuntimeAction;
  lastRuntimeScope: StudioRuntimeExecutionScope;
  lastRuntimeAt: number | null;
  runtimeErrorSummary: string | null;

  nodes: StudioFlowNode[];
  edges: StudioFlowEdge[];
  selectedNodeId: string | null;
  activeEditorRef: string | null;
  editorDrafts: Record<string, EditorDraftSession>;
  runtimePreview: StudioRuntimePreview;
  selectedScopePromptPreview: StudioRenderedPromptPreview | null;
  latestScopeOutputs: Record<string, StudioPromptUnitOutput>;
  nodeRuntimeStates: Record<string, NodeRuntimeState>;
  nodeExecutionRecords: Record<string, NodeExecutionRecord>;

  setYamlText: (next: string) => void;
  loadPromptYaml: (yamlText: string, sourceLabel?: string) => void;
  createStarterPrompt: (artifactType: StarterArtifactChoice) => void;
  importFromYaml: () => void;
  savePrompt: () => { filename: string; yamlText: string } | null;
  resetToSaved: () => void;
  refreshRuntimePreview: () => void;
  refreshSelectedScopePromptPreview: () => void;
  runRuntimeAction: (action: StudioRuntimeAction) => void;
  runFocusedBlockRuntimeAction: (action: Exclude<StudioRuntimeAction, "build">) => void;
  runSelectedScopeRuntimeAction: (action: StudioRuntimeAction) => void;
  setSelectedNodeId: (id: string | null) => void;
  updateActiveEditorDraft: (draft: EditorDraft) => void;
  applyActiveEditorDraft: () => void;
  resetActiveEditorDraft: () => void;
  selectFirstNodeByKind: (kind: StudioNodeKind) => void;
  focusBlock: (blockId: string | null) => void;
  toggleBlockCollapsed: (blockId: string) => void;
  setPaletteFocusKind: (kind: StudioNodeKind | null) => void;
  onNodesChange: (changes: NodeChange<StudioFlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<StudioFlowEdge>[]) => void;
  applyGraphIntent: (intent: GraphEditIntent | BlockEditIntent) => void;
  addCanonicalNode: (kind: GraphAddableNodeKind) => void;
  removeSelectedNode: () => void;
  runNode: (nodeId: string) => void;
  stopNode: (nodeId: string) => void;
  toggleNodeEnabled: (nodeId: string) => void;
};

type HydratedGraphState = {
  canonicalPrompt: Prompt;
  yamlText: string;
  nodes: StudioFlowNode[];
  edges: StudioFlowEdge[];
  selectedNodeId: string | null;
  activeEditorRef: string | null;
  editorDrafts: Record<string, EditorDraftSession>;
  focusedBlockId: string | null;
  runtimePreview: StudioRuntimePreview;
  selectedScopePromptPreview: StudioRenderedPromptPreview | null;
  latestScopeOutputs: Record<string, StudioPromptUnitOutput>;
  nodeRuntimeStates: Record<string, NodeRuntimeState>;
  nodeExecutionRecords: Record<string, NodeExecutionRecord>;
  runtimeRefreshedAt: number;
};

type RuntimeNodeTarget =
  | {
      kind: "prompt";
      runtimeNodeId: string;
      scope: StudioRuntimeExecutionScope;
    }
  | {
      kind: "block";
      runtimeNodeId: string;
      scope: StudioRuntimeExecutionScope;
      blockId: string;
    };

type ActiveNodeExecutionHandle = {
  executionId: string;
  controller: AbortController;
  timerId: ReturnType<typeof setTimeout> | null;
  started: boolean;
};

const activeNodeExecutionHandles = new Map<string, ActiveNodeExecutionHandle>();
const nodeExecutionRepository: NodeExecutionRepository = createInMemoryNodeExecutionRepository();
let nextNodeExecutionSequence = 1;

function getPromptRuntimeNodeId(prompt: Prompt): string {
  return `prompt_root_${prompt.metadata.id}`;
}

function createExecutionId(): string {
  const executionId = `node_exec_${nextNodeExecutionSequence}`;
  nextNodeExecutionSequence += 1;
  return executionId;
}

function listPromptBlockIds(blocks: PromptBlock[]): string[] {
  return blocks.flatMap((block) => [block.id, ...listPromptBlockIds(block.children)]);
}

function createNodeRuntimeStates(
  prompt: Prompt,
  previousStates: Record<string, NodeRuntimeState> = {},
): Record<string, NodeRuntimeState> {
  const rootRuntimeNodeId = getPromptRuntimeNodeId(prompt);
  const orderedNodeIds = [rootRuntimeNodeId, ...listPromptBlockIds(prompt.spec.blocks)];

  return Object.fromEntries(
    orderedNodeIds.map((nodeId) => {
      const previous = previousStates[nodeId];
      return [
        nodeId,
        {
          nodeId,
          status: previous?.status ?? "idle",
          enabled: nodeId === rootRuntimeNodeId ? true : previous?.enabled ?? true,
          ...(previous?.activeExecutionId !== undefined ? { activeExecutionId: previous.activeExecutionId } : {}),
          ...(previous?.lastExecutionId !== undefined ? { lastExecutionId: previous.lastExecutionId } : {}),
          ...(previous?.startedAt !== undefined ? { startedAt: previous.startedAt } : {}),
          ...(previous?.output !== undefined ? { output: previous.output } : {}),
          ...(previous?.lastRunAt !== undefined ? { lastRunAt: previous.lastRunAt } : {}),
          ...(previous?.cancelRequestedAt !== undefined ? { cancelRequestedAt: previous.cancelRequestedAt } : {}),
          ...(previous?.upstreamSnapshotHash !== undefined ? { upstreamSnapshotHash: previous.upstreamSnapshotHash } : {}),
        },
      ];
    }),
  );
}

function listPromptRuntimeNodeIds(prompt: Prompt): string[] {
  return [getPromptRuntimeNodeId(prompt), ...listPromptBlockIds(prompt.spec.blocks)];
}

function listPersistedNodeExecutionRecords(prompt: Prompt): Record<string, NodeExecutionRecord> {
  const runtimeNodeIds = listPromptRuntimeNodeIds(prompt);
  nodeExecutionRepository.pruneToPrompt(prompt.metadata.id, runtimeNodeIds);
  return Object.fromEntries(
    nodeExecutionRepository
      .listByPromptNodeIds(prompt.metadata.id, runtimeNodeIds)
      .map((record) => [record.executionId, record]),
  );
}

function hasNodeExecutionHistory(state: NodeRuntimeState): boolean {
  return state.lastRunAt !== undefined || state.output !== undefined || state.status !== "idle";
}

function clearActiveRuntimeFields(state: NodeRuntimeState): NodeRuntimeState {
  const { activeExecutionId: _activeExecutionId, cancelRequestedAt: _cancelRequestedAt, ...rest } = state;
  return rest;
}

function startRuntimeState(
  state: NodeRuntimeState,
  executionId: string,
  startedAt: Date,
  sourceSnapshotHash: string,
): NodeRuntimeState {
  const { cancelRequestedAt: _cancelRequestedAt, ...rest } = state;
  return {
    ...rest,
    status: "running",
    activeExecutionId: executionId,
    lastExecutionId: executionId,
    startedAt,
    upstreamSnapshotHash: sourceSnapshotHash,
  };
}

function markRuntimeStateCancelRequested(state: NodeRuntimeState, requestedAt: Date): NodeRuntimeState {
  return {
    ...state,
    cancelRequestedAt: state.cancelRequestedAt ?? requestedAt,
  };
}

function completeRuntimeState(
  state: NodeRuntimeState,
  executionId: string,
  completedAt: Date,
  status: "success" | "error",
  output?: string,
): NodeRuntimeState {
  const { activeExecutionId: _activeExecutionId, cancelRequestedAt: _cancelRequestedAt, ...rest } = state;
  return {
    ...rest,
    status,
    lastExecutionId: executionId,
    lastRunAt: completedAt,
    ...(output !== undefined ? { output } : {}),
  };
}

function cancelRuntimeState(state: NodeRuntimeState, executionId: string): NodeRuntimeState {
  const { activeExecutionId: _activeExecutionId, cancelRequestedAt: _cancelRequestedAt, ...rest } = state;
  return {
    ...rest,
    status: state.lastRunAt || state.output ? "stale" : "idle",
    lastExecutionId: executionId,
  };
}

function isExecutionRecordActive(record: NodeExecutionRecord | undefined): boolean {
  return record?.status === "running" || record?.status === "cancel_requested";
}

function invalidateNodeRuntimeStates(states: Record<string, NodeRuntimeState>): Record<string, NodeRuntimeState> {
  return Object.fromEntries(
    Object.entries(states).map(([nodeId, state]) => {
      if (!hasNodeExecutionHistory(state)) {
        return [nodeId, state];
      }

      if (state.status === "running" && state.output === undefined && state.lastRunAt === undefined) {
        return [
          nodeId,
          {
            ...clearActiveRuntimeFields(state),
            status: "idle" as const,
          },
        ];
      }

      return [
        nodeId,
        {
          ...clearActiveRuntimeFields(state),
          status: "stale" as const,
        },
      ];
    }),
  );
}

function settleInterruptedExecutionRecords(
  promptId?: string,
  completedAt: Date = new Date(),
): void {
  const interruptedRecords = nodeExecutionRepository
    .listActive(promptId)
    .map((record) => cancelNodeExecutionRecord(requestNodeExecutionCancellation(record, completedAt), completedAt));
  nodeExecutionRepository.putMany(interruptedRecords);
}

function clearPendingNodeExecutions(): void {
  activeNodeExecutionHandles.forEach((handle) => {
    if (handle.timerId) {
      clearTimeout(handle.timerId);
    }
    handle.controller.abort();
  });
  activeNodeExecutionHandles.clear();
}

function findBlockById(blocks: PromptBlock[], blockId: string): PromptBlock | null {
  for (const block of blocks) {
    if (block.id === blockId) {
      return block;
    }
    const nested = findBlockById(block.children, blockId);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function collectDescendantBlockIds(block: PromptBlock): string[] {
  return block.children.flatMap((child) => [child.id, ...collectDescendantBlockIds(child)]);
}

function listStaleDescendantNodeIds(prompt: Prompt, target: RuntimeNodeTarget): string[] {
  if (target.kind === "prompt") {
    return listPromptBlockIds(prompt.spec.blocks);
  }

  const block = findBlockById(prompt.spec.blocks, target.blockId);
  return block ? collectDescendantBlockIds(block) : [];
}

function describeRuntimePreviewOutput(preview: StudioRuntimePreview): string | undefined {
  if (preview.issues.length > 0) {
    return preview.issues.map((issue) => issue.message).join("\n");
  }

  return undefined;
}

function resolveRuntimeNodeTarget(state: Pick<StudioState, "canonicalPrompt" | "nodes">, nodeId: string): RuntimeNodeTarget | null {
  const prompt = state.canonicalPrompt;
  if (!prompt) {
    return null;
  }

  const node = state.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    return null;
  }

  if (node.data.kind === "prompt") {
    return {
      kind: "prompt",
      runtimeNodeId: getPromptRuntimeNodeId(prompt),
      scope: { mode: "root" },
    };
  }

  if (node.data.kind !== "block") {
    return null;
  }

  const blockId = node.data.properties.__blockId ?? node.data.properties.blockId;
  if (!blockId) {
    return null;
  }

  return {
    kind: "block",
    runtimeNodeId: blockId,
    blockId,
    scope: { mode: "block", blockId },
  };
}

function clonePrompt(prompt: Prompt): Prompt {
  return JSON.parse(JSON.stringify(prompt)) as Prompt;
}

function digestPrompt(prompt: Prompt): string {
  return JSON.stringify(prompt);
}

function serializePrompt(prompt: Prompt): string {
  return YAML.stringify(prompt);
}

function emptyRuntimePreview(): StudioRuntimePreview {
  return {
    issues: [],
  };
}

function createEmptyScopeRuntimeState() {
  return {
    selectedScopePromptPreview: null as StudioRenderedPromptPreview | null,
    latestScopeOutputs: {} as Record<string, StudioPromptUnitOutput>,
  };
}

function omitDraftSession(drafts: Record<string, EditorDraftSession>, ref: string | null): Record<string, EditorDraftSession> {
  if (!ref || !drafts[ref]) return drafts;
  const nextDrafts = { ...drafts };
  delete nextDrafts[ref];
  return nextDrafts;
}

function syncEditorDraftState(input: {
  canonicalPrompt: Prompt | null;
  nodes: StudioFlowNode[];
  selectedNodeId: string | null;
  focusedBlockId: string | null;
  editorDrafts: Record<string, EditorDraftSession>;
}): { activeEditorRef: string | null; editorDrafts: Record<string, EditorDraftSession> } {
  const { canonicalPrompt, nodes, selectedNodeId, focusedBlockId, editorDrafts } = input;
  if (!canonicalPrompt) {
    return {
      activeEditorRef: null,
      editorDrafts: {},
    };
  }

  const selection = resolveEditorSelection({
    canonicalPrompt,
    nodes,
    selectedNodeId,
    focusedBlockId,
  });
  if (!selection) {
    return {
      activeEditorRef: null,
      editorDrafts: {},
    };
  }

  const activeEditorRef = selection.ref;
  const nextDrafts: Record<string, EditorDraftSession> = {};

  for (const [ref, session] of Object.entries(editorDrafts)) {
    if (!session.dirty || ref === activeEditorRef) {
      continue;
    }
    const canonicalSelection = resolveSelectionByRef(canonicalPrompt, nodes, ref);
    if (!canonicalSelection) {
      continue;
    }
    nextDrafts[ref] = session;
  }

  const existingSession = editorDrafts[activeEditorRef];
  if (existingSession?.dirty) {
    nextDrafts[activeEditorRef] = existingSession;
  } else {
    nextDrafts[activeEditorRef] = createEditorDraftSession(selection);
  }

  return {
    activeEditorRef,
    editorDrafts: nextDrafts,
  };
}

function syncSelectedScopeRuntimeState(input: {
  canonicalPrompt: Prompt | null;
  selectedNodeId: string | null;
  latestScopeOutputs: Record<string, StudioPromptUnitOutput>;
}): { selectedScopePromptPreview: StudioRenderedPromptPreview | null; latestScopeOutputs: Record<string, StudioPromptUnitOutput> } {
  const { canonicalPrompt, selectedNodeId, latestScopeOutputs } = input;
  if (!canonicalPrompt) {
    return createEmptyScopeRuntimeState();
  }

  const sourceSnapshotHash = digestPrompt(canonicalPrompt);
  const scope = resolveSelectedStudioScope(canonicalPrompt, selectedNodeId);
  return {
    selectedScopePromptPreview: createRenderedPromptPreview(canonicalPrompt, scope, sourceSnapshotHash),
    latestScopeOutputs,
  };
}

function createApplyIntentForSelection(selection: EditorSelection, draft: EditorDraft):
  | { ok: true; intent: GraphEditIntent | BlockEditIntent }
  | { ok: false; message: string } {
  if (selection.kind === "prompt" && draft.entityKind === "prompt") {
    const parsedInputs = parseInputDrafts(draft.inputs);
    if (!parsedInputs.ok) {
      return { ok: false, message: parsedInputs.message };
    }
    const parsedEvaluation = parseEvaluationDraft(draft);
    if (!parsedEvaluation.ok) {
      return { ok: false, message: parsedEvaluation.message };
    }
    return {
      ok: true,
      intent: {
        type: "node.patch",
        nodeId: selection.promptNodeId,
        changes: {
          title: draft.title,
          description: draft.description,
          tags: draft.tags,
          artifactType: draft.artifactType,
          buildTarget: draft.buildTarget,
          messages: draft.messages,
          inputs: parsedInputs.value,
          evaluation: parsedEvaluation.value,
        },
      },
    };
  }

  if (selection.kind === "block" && draft.entityKind === "block") {
    const parsedInputs = parseInputDrafts(draft.inputs);
    if (!parsedInputs.ok) {
      return { ok: false, message: parsedInputs.message };
    }
    return {
      ok: true,
      intent: {
        type: "block.patch",
        blockId: selection.block.id,
        changes: {
          blockKind: draft.blockKind,
          title: draft.title,
          description: draft.description,
          messages: draft.messages,
          inputs: parsedInputs.value,
        },
      },
    };
  }

  if (selection.kind === "use_prompt" && draft.entityKind === "use_prompt") {
    return {
      ok: true,
      intent: {
        type: "node.patch",
        nodeId: selection.nodeId,
        changes: {
          prompt: draft.prompt,
          mode: draft.mode,
          version: draft.version,
        },
      },
    };
  }

  return {
    ok: false,
    message: "Active draft does not match the selected entity.",
  };
}

function emptyState() {
  return {
    canonicalPrompt: null as Prompt | null,
    savedPrompt: null as Prompt | null,
    savedPromptDigest: null as string | null,
    sourceLabel: "No prompt loaded",
    paletteFocusKind: null as StudioNodeKind | null,
    focusedBlockId: null as string | null,
    collapsedBlockIds: [] as string[],
    yamlText: "",
    importError: null as string | null,
    syncIssues: [] as string[],
    isDirty: false,
    hasYamlDraftChanges: false,
    lastSavedAt: null as number | null,
    runtimeRefreshedAt: null as number | null,
    executionStatus: "idle" as StudioRuntimeExecutionStatus,
    lastRuntimeAction: undefined as StudioRuntimeAction | undefined,
    lastRuntimeScope: { mode: "root" } as StudioRuntimeExecutionScope,
    lastRuntimeAt: null as number | null,
    runtimeErrorSummary: null as string | null,
    nodes: [] as StudioFlowNode[],
    edges: [] as StudioFlowEdge[],
    selectedNodeId: null as string | null,
    activeEditorRef: null as string | null,
    editorDrafts: {} as Record<string, EditorDraftSession>,
    runtimePreview: emptyRuntimePreview(),
    ...createEmptyScopeRuntimeState(),
    nodeRuntimeStates: {} as Record<string, NodeRuntimeState>,
    nodeExecutionRecords: {} as Record<string, NodeExecutionRecord>,
  };
}

function hydrateFromCanonicalPrompt(
  prompt: Prompt,
  selectedNodeId: string | null,
  focusedBlockId: string | null,
  editorDrafts: Record<string, EditorDraftSession>,
  latestScopeOutputs: Record<string, StudioPromptUnitOutput>,
  runtimePreview?: StudioRuntimePreview,
  previousNodeRuntimeStates: Record<string, NodeRuntimeState> = {},
): HydratedGraphState {
  const graph = canonicalPromptToGraph(prompt, focusedBlockId);
  const promptSelectionId = `prompt:${prompt.metadata.id}`;
  const nextSelectedNodeId =
    selectedNodeId && (selectedNodeId === promptSelectionId || graph.nodes.some((node) => node.id === selectedNodeId))
      ? selectedNodeId
      : null;
  const editorState = syncEditorDraftState({
    canonicalPrompt: prompt,
    nodes: graph.nodes,
    selectedNodeId: nextSelectedNodeId,
    focusedBlockId,
    editorDrafts,
  });
  const scopeRuntimeState = syncSelectedScopeRuntimeState({
    canonicalPrompt: prompt,
    selectedNodeId: nextSelectedNodeId,
    latestScopeOutputs,
  });

  return {
    canonicalPrompt: prompt,
    yamlText: serializePrompt(prompt),
    nodes: graph.nodes,
    edges: graph.edges,
    selectedNodeId: nextSelectedNodeId,
    activeEditorRef: editorState.activeEditorRef,
    editorDrafts: editorState.editorDrafts,
    focusedBlockId,
    runtimePreview: runtimePreview ?? createRuntimePreviewFromPrompt(prompt, "resolve"),
    selectedScopePromptPreview: scopeRuntimeState.selectedScopePromptPreview,
    latestScopeOutputs: scopeRuntimeState.latestScopeOutputs,
    nodeRuntimeStates: createNodeRuntimeStates(prompt, previousNodeRuntimeStates),
    nodeExecutionRecords: listPersistedNodeExecutionRecords(prompt),
    runtimeRefreshedAt: Date.now(),
  };
}

function parseYamlToCanonical(yamlText: string):
  | { ok: true; prompt: Prompt; runtimePreview: StudioRuntimePreview }
  | { ok: false; message: string } {
  try {
    const loaded = createRuntimePreviewFromYaml(yamlText, "resolve");
    return {
      ok: true,
      prompt: loaded.prompt,
      runtimePreview: loaded.preview,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message };
  }
}

function buildPopulatedState(prompt: Prompt, sourceLabel: string, selectedNodeId: string | null, runtimePreview?: StudioRuntimePreview) {
  const hydrated = hydrateFromCanonicalPrompt(prompt, selectedNodeId, null, {}, {}, runtimePreview);
  const savedPrompt = clonePrompt(prompt);
  const savedPromptDigest = digestPrompt(savedPrompt);

  return {
    ...hydrated,
    savedPrompt,
    savedPromptDigest,
    sourceLabel,
    paletteFocusKind: null as StudioNodeKind | null,
    collapsedBlockIds: [] as string[],
    importError: null as string | null,
    syncIssues: [] as string[],
    isDirty: false,
    hasYamlDraftChanges: false,
    lastSavedAt: Date.now() as number | null,
    executionStatus: "idle" as StudioRuntimeExecutionStatus,
    lastRuntimeAction: undefined as StudioRuntimeAction | undefined,
    lastRuntimeScope: { mode: "root" } as StudioRuntimeExecutionScope,
    lastRuntimeAt: null as number | null,
    runtimeErrorSummary: null as string | null,
  };
}

const initial = emptyState();

export const useStudioStore = create<StudioState>((set, get) => ({
  ...initial,

  setYamlText: (next) =>
    set((state) => ({
      yamlText: next,
      hasYamlDraftChanges: state.canonicalPrompt ? next !== serializePrompt(state.canonicalPrompt) : next.trim().length > 0,
    })),

  loadPromptYaml: (yamlText, sourceLabel = "studio://editor.prompt.yaml") =>
    set((state) => {
      const parsed = parseYamlToCanonical(yamlText);
      if (!parsed.ok) {
        return {
          importError: parsed.message,
          syncIssues: [],
          runtimePreview: {
            ...state.runtimePreview,
            issues: [{ filepath: "studio://load", message: parsed.message }],
          },
          executionStatus: "failure" as StudioRuntimeExecutionStatus,
          runtimeErrorSummary: parsed.message,
          lastRuntimeAt: Date.now(),
        };
      }

      clearPendingNodeExecutions();
      if (state.canonicalPrompt) {
        settleInterruptedExecutionRecords(state.canonicalPrompt.metadata.id);
      }
      return buildPopulatedState(parsed.prompt, sourceLabel, state.selectedNodeId, parsed.runtimePreview);
    }),

  createStarterPrompt: (artifactType) =>
    set((state) => {
      clearPendingNodeExecutions();
      if (state.canonicalPrompt) {
        settleInterruptedExecutionRecords(state.canonicalPrompt.metadata.id);
      }
      const prompt = createStarterPrompt(artifactType);
      return buildPopulatedState(prompt, `starter://${artifactType}`, state.selectedNodeId);
    }),

  importFromYaml: () => {
    const state = get();
    if (!state.yamlText.trim()) return;
    get().loadPromptYaml(state.yamlText, state.sourceLabel === "No prompt loaded" ? "studio://draft.prompt.yaml" : state.sourceLabel);
  },

  savePrompt: () => {
    const state = get();
    if (!state.canonicalPrompt) return null;

    const yamlText = serializePrompt(state.canonicalPrompt);
    const savedPrompt = clonePrompt(state.canonicalPrompt);
    const savedPromptDigest = digestPrompt(savedPrompt);
    const now = Date.now();

    set({
      yamlText,
      savedPrompt,
      savedPromptDigest,
      isDirty: false,
      hasYamlDraftChanges: false,
      lastSavedAt: now,
      importError: null,
      syncIssues: [],
    });

    return {
      filename: `${state.canonicalPrompt.metadata.id}.prompt.yaml`,
      yamlText,
    };
  },

  resetToSaved: () =>
    set((state) => {
      if (!state.savedPrompt) return {};
      clearPendingNodeExecutions();
      settleInterruptedExecutionRecords(state.savedPrompt.metadata.id);
      const restored = clonePrompt(state.savedPrompt);
      const hydrated = hydrateFromCanonicalPrompt(
        restored,
        state.selectedNodeId,
        state.focusedBlockId,
        {},
        {},
        undefined,
        state.nodeRuntimeStates,
      );
      return {
        ...hydrated,
        nodeRuntimeStates: invalidateNodeRuntimeStates(hydrated.nodeRuntimeStates),
        nodeExecutionRecords: hydrated.nodeExecutionRecords,
        importError: null,
        syncIssues: [],
        isDirty: false,
        hasYamlDraftChanges: false,
        executionStatus: "idle" as StudioRuntimeExecutionStatus,
        runtimeErrorSummary: null,
        paletteFocusKind: null,
      };
    }),

  refreshRuntimePreview: () => {
    const state = get();
    const action = state.lastRuntimeAction ?? "resolve";
    if (state.lastRuntimeScope.mode === "block" && action !== "build") {
      state.runFocusedBlockRuntimeAction(action);
      return;
    }
    state.runRuntimeAction(action);
  },

  refreshSelectedScopePromptPreview: () =>
    set((state) => {
      const scopeRuntimeState = syncSelectedScopeRuntimeState({
        canonicalPrompt: state.canonicalPrompt,
        selectedNodeId: state.selectedNodeId,
        latestScopeOutputs: state.latestScopeOutputs,
      });
      return scopeRuntimeState;
    }),

  runRuntimeAction: (action) => {
    const prompt = get().canonicalPrompt;
    if (!prompt) {
      set({
        executionStatus: "failure",
        lastRuntimeAction: action,
        lastRuntimeScope: { mode: "root" },
        lastRuntimeAt: Date.now(),
        runtimeErrorSummary: "No prompt loaded.",
        runtimePreview: {
          issues: [{ filepath: "studio://runtime", message: "No prompt loaded." }],
        },
      });
      return;
    }

    set({
      executionStatus: "running",
      runtimeErrorSummary: null,
      lastRuntimeAction: action,
      lastRuntimeScope: { mode: "root" },
    });

    const result = executeRuntimeActionFromPrompt(prompt, action, { mode: "root" });
    const now = Date.now();
    const latestRootOutput = createPromptUnitOutput(prompt, { mode: "root" }, action, result.preview, digestPrompt(prompt));

    set({
      runtimePreview: result.preview,
      runtimeRefreshedAt: now,
      executionStatus: result.success ? "success" : "failure",
      lastRuntimeAction: action,
      lastRuntimeScope: { mode: "root" },
      lastRuntimeAt: now,
      runtimeErrorSummary: result.errorSummary ?? null,
      latestScopeOutputs: {
        ...get().latestScopeOutputs,
        [latestRootOutput.scope.scopeRef]: latestRootOutput,
      },
    });
  },

  runFocusedBlockRuntimeAction: (action) => {
    const state = get();
    const prompt = state.canonicalPrompt;
    const blockId = state.focusedBlockId;
    if (!prompt || !blockId) {
      set({
        executionStatus: "failure",
        lastRuntimeAction: action,
        lastRuntimeScope: { mode: "block", blockId: blockId ?? "unknown" },
        lastRuntimeAt: Date.now(),
        runtimeErrorSummary: "No focused block.",
        runtimePreview: {
          issues: [{ filepath: "studio://runtime", message: "No focused block." }],
          scope: { mode: "block", blockId: blockId ?? "unknown" },
        },
      });
      return;
    }

    set({
      executionStatus: "running",
      runtimeErrorSummary: null,
      lastRuntimeAction: action,
      lastRuntimeScope: { mode: "block", blockId },
    });

    const result = executeRuntimeActionFromPrompt(prompt, action, { mode: "block", blockId });
    const now = Date.now();
    const latestBlockOutput = createPromptUnitOutput(prompt, { mode: "block", blockId }, action, result.preview, digestPrompt(prompt));

    set({
      runtimePreview: result.preview,
      runtimeRefreshedAt: now,
      executionStatus: result.success ? "success" : "failure",
      lastRuntimeAction: action,
      lastRuntimeScope: { mode: "block", blockId },
      lastRuntimeAt: now,
      runtimeErrorSummary: result.errorSummary ?? null,
      latestScopeOutputs: {
        ...get().latestScopeOutputs,
        [latestBlockOutput.scope.scopeRef]: latestBlockOutput,
      },
    });
  },

  runSelectedScopeRuntimeAction: (action) => {
    const state = get();
    const prompt = state.canonicalPrompt;
    if (!prompt) {
      set({
        executionStatus: "failure",
        lastRuntimeAction: action,
        lastRuntimeScope: { mode: "root" },
        lastRuntimeAt: Date.now(),
        runtimeErrorSummary: "No prompt loaded.",
        runtimePreview: {
          issues: [{ filepath: "studio://runtime", message: "No prompt loaded." }],
        },
      });
      return;
    }

    const scope = resolveSelectedStudioScope(prompt, state.selectedNodeId);
    set({
      executionStatus: "running",
      runtimeErrorSummary: null,
      lastRuntimeAction: action,
      lastRuntimeScope: scope,
    });

    const result = executeRuntimeActionFromPrompt(prompt, action, scope);
    const now = Date.now();
    const latestOutput = createPromptUnitOutput(prompt, scope, action, result.preview, digestPrompt(prompt));

    set({
      runtimePreview: result.preview,
      runtimeRefreshedAt: now,
      executionStatus: result.success ? "success" : "failure",
      lastRuntimeAction: action,
      lastRuntimeScope: scope,
      lastRuntimeAt: now,
      runtimeErrorSummary: result.errorSummary ?? null,
      latestScopeOutputs: {
        ...get().latestScopeOutputs,
        [latestOutput.scope.scopeRef]: latestOutput,
      },
    });
  },

  setSelectedNodeId: (id) =>
    set((state) => {
      const editorState = syncEditorDraftState({
        canonicalPrompt: state.canonicalPrompt,
        nodes: state.nodes,
        selectedNodeId: id,
        focusedBlockId: state.focusedBlockId,
        editorDrafts: state.editorDrafts,
      });
      const scopeRuntimeState = syncSelectedScopeRuntimeState({
        canonicalPrompt: state.canonicalPrompt,
        selectedNodeId: id,
        latestScopeOutputs: state.latestScopeOutputs,
      });
      return {
        selectedNodeId: id,
        ...editorState,
        ...scopeRuntimeState,
      };
    }),

  updateActiveEditorDraft: (draft) =>
    set((state) => {
      const activeEditorRef = state.activeEditorRef;
      if (!activeEditorRef) return {};
      const currentSession = state.editorDrafts[activeEditorRef];
      if (!currentSession) return {};
      return {
        editorDrafts: {
          ...state.editorDrafts,
          [activeEditorRef]: {
            ...currentSession,
            draft,
            dirty: getDraftHash(draft) !== currentSession.lastSyncedCanonicalHash,
            validationError: null,
          },
        },
      };
    }),

  applyActiveEditorDraft: () =>
    set((state) => {
      if (!state.canonicalPrompt || !state.activeEditorRef) {
        return {};
      }

      const selection = resolveEditorSelection({
        canonicalPrompt: state.canonicalPrompt,
        nodes: state.nodes,
        selectedNodeId: state.selectedNodeId,
        focusedBlockId: state.focusedBlockId,
      });
      if (!selection || selection.ref !== state.activeEditorRef) {
        return {
          syncIssues: ["Active editor session is out of sync with selection."],
        };
      }

      const session = state.editorDrafts[state.activeEditorRef];
      if (!session) {
        return {
          syncIssues: ["No active editor draft."],
        };
      }

      const intentResult = createApplyIntentForSelection(selection, session.draft);
      if (!intentResult.ok) {
        return {
          editorDrafts: {
            ...state.editorDrafts,
            [state.activeEditorRef]: {
              ...session,
              validationError: intentResult.message,
            },
          },
        };
      }

      const result = applyGraphIntentToPrompt(state.canonicalPrompt, { nodes: state.nodes, edges: state.edges }, intentResult.intent);
      if (!result.supported) {
        return {
          syncIssues: result.issues.map((issue) => `${issue.nodeId ? `${issue.nodeId}: ` : ""}${issue.message}`),
        };
      }

      clearPendingNodeExecutions();
      settleInterruptedExecutionRecords(state.canonicalPrompt.metadata.id);
      const hydrated = hydrateFromCanonicalPrompt(
        result.prompt,
        state.selectedNodeId,
        state.focusedBlockId,
        omitDraftSession(state.editorDrafts, state.activeEditorRef),
        state.latestScopeOutputs,
        undefined,
        state.nodeRuntimeStates,
      );
      const isDirty = state.savedPromptDigest ? digestPrompt(result.prompt) !== state.savedPromptDigest : true;

      return {
        ...hydrated,
        nodeRuntimeStates: invalidateNodeRuntimeStates(hydrated.nodeRuntimeStates),
        nodeExecutionRecords: hydrated.nodeExecutionRecords,
        importError: null,
        syncIssues: [],
        isDirty,
        hasYamlDraftChanges: false,
        executionStatus: "idle" as StudioRuntimeExecutionStatus,
        runtimeErrorSummary: null,
      };
    }),

  resetActiveEditorDraft: () =>
    set((state) => {
      if (!state.canonicalPrompt || !state.activeEditorRef) {
        return {};
      }
      const selection = resolveEditorSelection({
        canonicalPrompt: state.canonicalPrompt,
        nodes: state.nodes,
        selectedNodeId: state.selectedNodeId,
        focusedBlockId: state.focusedBlockId,
      });
      if (!selection || selection.ref !== state.activeEditorRef) {
        return {
          editorDrafts: omitDraftSession(state.editorDrafts, state.activeEditorRef),
          activeEditorRef: null,
        };
      }
      return {
        editorDrafts: {
          ...state.editorDrafts,
          [state.activeEditorRef]: createEditorDraftSession(selection),
        },
      };
    }),

  selectFirstNodeByKind: (kind) =>
    set((state) => {
      if (!state.canonicalPrompt) return {};
      if (kind === "prompt") {
        const selectedNodeId = `prompt:${state.canonicalPrompt.metadata.id}`;
        const editorState = syncEditorDraftState({
          canonicalPrompt: state.canonicalPrompt,
          nodes: state.nodes,
          selectedNodeId,
          focusedBlockId: null,
          editorDrafts: state.editorDrafts,
        });
        const scopeRuntimeState = syncSelectedScopeRuntimeState({
          canonicalPrompt: state.canonicalPrompt,
          selectedNodeId,
          latestScopeOutputs: state.latestScopeOutputs,
        });
        return {
          focusedBlockId: null,
          selectedNodeId,
          ...editorState,
          ...scopeRuntimeState,
        };
      }

      const selectedNodeId = state.nodes.find((node) => node.data.kind === kind)?.id ?? state.selectedNodeId;
      const editorState = syncEditorDraftState({
        canonicalPrompt: state.canonicalPrompt,
        nodes: state.nodes,
        selectedNodeId,
        focusedBlockId: state.focusedBlockId,
        editorDrafts: state.editorDrafts,
      });
      const scopeRuntimeState = syncSelectedScopeRuntimeState({
        canonicalPrompt: state.canonicalPrompt,
        selectedNodeId,
        latestScopeOutputs: state.latestScopeOutputs,
      });
      return {
        selectedNodeId,
        ...editorState,
        ...scopeRuntimeState,
      };
    }),

  focusBlock: (blockId) =>
    set((state) => {
      if (!state.canonicalPrompt) return {};
      const graph = canonicalPromptToGraph(state.canonicalPrompt, blockId);
      const preferredNodeId = blockId ? `block:${blockId}` : null;
      const selectedNodeId =
        preferredNodeId && graph.nodes.some((node) => node.id === preferredNodeId)
          ? preferredNodeId
          : graph.nodes[0]?.id ?? null;
      const editorState = syncEditorDraftState({
        canonicalPrompt: state.canonicalPrompt,
        nodes: graph.nodes,
        selectedNodeId,
        focusedBlockId: blockId,
        editorDrafts: state.editorDrafts,
      });
      const scopeRuntimeState = syncSelectedScopeRuntimeState({
        canonicalPrompt: state.canonicalPrompt,
        selectedNodeId,
        latestScopeOutputs: state.latestScopeOutputs,
      });
      return {
        focusedBlockId: blockId,
        nodes: graph.nodes,
        edges: graph.edges,
        selectedNodeId,
        ...editorState,
        ...scopeRuntimeState,
      };
    }),

  toggleBlockCollapsed: (blockId) =>
    set((state) => ({
      collapsedBlockIds: state.collapsedBlockIds.includes(blockId)
        ? state.collapsedBlockIds.filter((id) => id !== blockId)
        : [...state.collapsedBlockIds, blockId],
    })),

  setPaletteFocusKind: (kind) => set({ paletteFocusKind: kind }),

  onNodesChange: (changes) =>
    set((state) => {
      const visualOnlyChanges = changes.filter(
        (change) => change.type === "position" || change.type === "dimensions" || change.type === "select",
      );
      return {
        nodes: applyNodeChanges(visualOnlyChanges, state.nodes),
      };
    }),

  onEdgesChange: (changes) =>
    set((state) => {
      const visualOnlyChanges = changes.filter((change) => change.type === "select");
      return {
        edges: applyEdgeChanges(visualOnlyChanges, state.edges),
      };
    }),

  applyGraphIntent: (intent) =>
    set((state) => {
      if (!state.canonicalPrompt) {
        return {
          syncIssues: ["No prompt loaded."],
        };
      }

      const result = applyGraphIntentToPrompt(state.canonicalPrompt, { nodes: state.nodes, edges: state.edges }, intent);
      if (!result.supported) {
        return {
          syncIssues: result.issues.map((issue) => `${issue.nodeId ? `${issue.nodeId}: ` : ""}${issue.message}`),
        };
      }

      clearPendingNodeExecutions();
      settleInterruptedExecutionRecords(state.canonicalPrompt.metadata.id);
      const nextFocusedBlockId =
        intent.type === "block.remove"
          ? state.focusedBlockId === intent.blockId
            ? null
            : state.focusedBlockId
          : intent.type === "block.add"
            ? intent.parentBlockId ?? state.focusedBlockId
            : "blockId" in intent
              ? intent.blockId
              : state.focusedBlockId;
      const hydrated = hydrateFromCanonicalPrompt(
        result.prompt,
        state.selectedNodeId,
        nextFocusedBlockId,
        state.editorDrafts,
        state.latestScopeOutputs,
        undefined,
        state.nodeRuntimeStates,
      );
      const isDirty = state.savedPromptDigest ? digestPrompt(result.prompt) !== state.savedPromptDigest : true;

      return {
        ...hydrated,
        nodeRuntimeStates: invalidateNodeRuntimeStates(hydrated.nodeRuntimeStates),
        nodeExecutionRecords: hydrated.nodeExecutionRecords,
        importError: null,
        syncIssues: [],
        isDirty,
        hasYamlDraftChanges: false,
        executionStatus: "idle" as StudioRuntimeExecutionStatus,
        runtimeErrorSummary: null,
      };
    }),

  addCanonicalNode: (kind) => {
    get().applyGraphIntent({ type: "node.add", kind, targetBlockId: get().focusedBlockId });
  },

  removeSelectedNode: () => {
    const state = get();
    const selectedNodeId = state.selectedNodeId;
    if (!selectedNodeId) return;
    const selectedNode = state.nodes.find((node) => node.id === selectedNodeId);
    if (selectedNode?.data.kind === "block") {
      const blockId = selectedNode.data.properties.__blockId ?? selectedNode.data.properties.blockId;
      if (!blockId) return;
      state.applyGraphIntent({ type: "block.remove", blockId });
      return;
    }
    state.applyGraphIntent({ type: "node.remove", nodeId: selectedNodeId });
  },

  runNode: (nodeId) => {
    const state = get();
    const prompt = state.canonicalPrompt;
    if (!prompt) {
      return;
    }

    const target = resolveRuntimeNodeTarget(state, nodeId);
    if (!target) {
      return;
    }

    const currentRuntimeState = state.nodeRuntimeStates[target.runtimeNodeId];
    if (!currentRuntimeState) {
      return;
    }

    if (
      isExecutionRecordActive(
        currentRuntimeState.activeExecutionId ? nodeExecutionRepository.get(currentRuntimeState.activeExecutionId) : undefined,
      )
    ) {
      return;
    }

    const existingHandle = activeNodeExecutionHandles.get(target.runtimeNodeId);
    if (existingHandle) {
      if (existingHandle.timerId) {
        clearTimeout(existingHandle.timerId);
      }
      existingHandle.controller.abort();
      activeNodeExecutionHandles.delete(target.runtimeNodeId);
    }

    const executionId = createExecutionId();
    const startedAt = new Date();
    const promptSnapshot = clonePrompt(prompt);
    const sourceSnapshotHash = digestPrompt(promptSnapshot);
    const targetSnapshot = target.kind === "prompt" ? target : { ...target };
    const executionRecord = createNodeExecutionRecord({
      executionId,
      promptId: promptSnapshot.metadata.id,
      nodeId: target.runtimeNodeId,
      scope: targetSnapshot.scope,
      sourceSnapshotHash,
      startedAt,
    });
    const controller = new AbortController();
    const handle: ActiveNodeExecutionHandle = {
      executionId,
      controller,
      timerId: null,
      started: false,
    };

    activeNodeExecutionHandles.set(target.runtimeNodeId, handle);
    nodeExecutionRepository.put(executionRecord);

    set({
      nodeRuntimeStates: {
        ...state.nodeRuntimeStates,
        [target.runtimeNodeId]: startRuntimeState(currentRuntimeState, executionId, startedAt, sourceSnapshotHash),
      },
      nodeExecutionRecords: {
        ...state.nodeExecutionRecords,
        [executionId]: executionRecord,
      },
    });

    const timerId = setTimeout(() => {
      const activeHandle = activeNodeExecutionHandles.get(target.runtimeNodeId);
      if (!activeHandle || activeHandle.executionId !== executionId) {
        return;
      }

      activeHandle.timerId = null;
      activeHandle.started = true;

      void (async () => {
        try {
          const result = await executeRuntimeActionFromPromptAsync(
            promptSnapshot,
            "resolve",
            targetSnapshot.scope,
            { signal: controller.signal },
          );
          if (controller.signal.aborted) {
            throw new Error("Execution aborted after runtime resolution.");
          }

          const executedAt = new Date();
          const renderedPromptPreview = createRenderedPromptPreview(promptSnapshot, targetSnapshot.scope, sourceSnapshotHash);
          const latestOutput = createPromptUnitOutput(promptSnapshot, targetSnapshot.scope, "resolve", result.preview, sourceSnapshotHash);
          const staleDescendantIds = listStaleDescendantNodeIds(promptSnapshot, targetSnapshot);
          const output = renderedPromptPreview.renderedText ?? describeRuntimePreviewOutput(result.preview);

          set((current) => {
            const latestRuntimeState = current.nodeRuntimeStates[target.runtimeNodeId];
            const latestExecutionRecord = nodeExecutionRepository.get(executionId);
            if (!latestRuntimeState || latestRuntimeState.activeExecutionId !== executionId || !latestExecutionRecord) {
              return {};
            }

            const nextNodeRuntimeStates = { ...current.nodeRuntimeStates };
            nextNodeRuntimeStates[target.runtimeNodeId] = completeRuntimeState(
              latestRuntimeState,
              executionId,
              executedAt,
              result.success ? "success" : "error",
              output,
            );

            staleDescendantIds.forEach((runtimeNodeId) => {
              const descendantState = nextNodeRuntimeStates[runtimeNodeId];
              if (!descendantState || descendantState.status === "idle") {
                return;
              }

              nextNodeRuntimeStates[runtimeNodeId] = {
                ...clearActiveRuntimeFields(descendantState),
                status: "stale",
              };
            });

            const completedRecord = result.success
              ? completeNodeExecutionRecord(latestExecutionRecord, { status: "success", output: output ?? "" }, executedAt)
              : completeNodeExecutionRecord(
                  latestExecutionRecord,
                  {
                    status: "error",
                    errorMessage: result.errorSummary ?? "Node execution failed.",
                    ...(output !== undefined ? { output } : {}),
                  },
                  executedAt,
                );
            nodeExecutionRepository.put(completedRecord);

            return {
              nodeRuntimeStates: nextNodeRuntimeStates,
              nodeExecutionRecords: {
                ...current.nodeExecutionRecords,
                [executionId]: completedRecord,
              },
              latestScopeOutputs: {
                ...current.latestScopeOutputs,
                [latestOutput.scope.scopeRef]: latestOutput,
              },
              selectedScopePromptPreview:
                current.selectedScopePromptPreview?.scope.scopeRef === renderedPromptPreview.scope.scopeRef
                  ? renderedPromptPreview
                  : current.selectedScopePromptPreview,
            };
          });
        } catch (error) {
          const activeState = get();
          const latestRuntimeState = activeState.nodeRuntimeStates[target.runtimeNodeId];
          const latestExecutionRecord = nodeExecutionRepository.get(executionId);
          if (!latestRuntimeState || latestRuntimeState.activeExecutionId !== executionId || !latestExecutionRecord) {
            return;
          }

          const cancelledAt = new Date();
          const isAbort = controller.signal.aborted;
          set((current) => {
            const runtimeState = current.nodeRuntimeStates[target.runtimeNodeId];
            const executionRecordState = nodeExecutionRepository.get(executionId);
            if (!runtimeState || runtimeState.activeExecutionId !== executionId || !executionRecordState) {
              return {};
            }

            const errorMessage = error instanceof Error ? error.message : String(error);
            const completedRecord = isAbort
              ? cancelNodeExecutionRecord(requestNodeExecutionCancellation(executionRecordState, cancelledAt), cancelledAt)
              : completeNodeExecutionRecord(
                  executionRecordState,
                  { status: "error", errorMessage },
                  cancelledAt,
                );
            nodeExecutionRepository.put(completedRecord);

            return {
              nodeRuntimeStates: {
                ...current.nodeRuntimeStates,
                [target.runtimeNodeId]: isAbort
                  ? cancelRuntimeState(runtimeState, executionId)
                  : completeRuntimeState(runtimeState, executionId, cancelledAt, "error", errorMessage),
              },
              nodeExecutionRecords: {
                ...current.nodeExecutionRecords,
                [executionId]: completedRecord,
              },
            };
          });
        } finally {
          const latestHandle = activeNodeExecutionHandles.get(target.runtimeNodeId);
          if (latestHandle?.executionId === executionId) {
            activeNodeExecutionHandles.delete(target.runtimeNodeId);
          }
        }
      })();
    }, 0);

    handle.timerId = timerId;
  },

  stopNode: (nodeId) => {
    const state = get();
    const target = resolveRuntimeNodeTarget(state, nodeId);
    if (!target) {
      return;
    }

    const handle = activeNodeExecutionHandles.get(target.runtimeNodeId);
    const currentRuntimeState = state.nodeRuntimeStates[target.runtimeNodeId];
    if (!handle || !currentRuntimeState || currentRuntimeState.activeExecutionId !== handle.executionId) {
      return;
    }

    const executionRecord = nodeExecutionRepository.get(handle.executionId);
    if (!executionRecord) {
      return;
    }

    const requestedAt = new Date();

    if (!handle.started) {
      if (handle.timerId) {
        clearTimeout(handle.timerId);
      }
      handle.controller.abort();
      activeNodeExecutionHandles.delete(target.runtimeNodeId);
      const cancelledRecord = cancelNodeExecutionRecord(requestNodeExecutionCancellation(executionRecord, requestedAt), requestedAt);
      nodeExecutionRepository.put(cancelledRecord);

      set({
        nodeRuntimeStates: {
          ...state.nodeRuntimeStates,
          [target.runtimeNodeId]: cancelRuntimeState(currentRuntimeState, handle.executionId),
        },
        nodeExecutionRecords: {
          ...state.nodeExecutionRecords,
          [handle.executionId]: cancelledRecord,
        },
      });
      return;
    }

    handle.controller.abort();
    const cancelRequestedRecord = requestNodeExecutionCancellation(executionRecord, requestedAt);
    nodeExecutionRepository.put(cancelRequestedRecord);
    set({
      nodeRuntimeStates: {
        ...state.nodeRuntimeStates,
        [target.runtimeNodeId]: markRuntimeStateCancelRequested(currentRuntimeState, requestedAt),
      },
      nodeExecutionRecords: {
        ...state.nodeExecutionRecords,
        [handle.executionId]: cancelRequestedRecord,
      },
    });
  },

  toggleNodeEnabled: (nodeId) => {
    const state = get();
    const target = resolveRuntimeNodeTarget(state, nodeId);
    if (!target || target.kind !== "block") {
      return;
    }

    const currentState = state.nodeRuntimeStates[target.runtimeNodeId];
    if (!currentState) {
      return;
    }

    set({
      nodeRuntimeStates: {
        ...state.nodeRuntimeStates,
        [target.runtimeNodeId]: {
          ...currentState,
          enabled: !currentState.enabled,
        },
      },
    });
  },
}));

export function resetStudioStoreForTests(yamlText?: string): void {
  clearPendingNodeExecutions();
  nodeExecutionRepository.clear();
  nextNodeExecutionSequence = 1;
  if (!yamlText) {
    useStudioStore.setState(emptyState());
    return;
  }

  const parsed = parseYamlToCanonical(yamlText);
  if (!parsed.ok) {
    throw new Error(`Invalid test YAML: ${parsed.message}`);
  }

  const next = buildPopulatedState(parsed.prompt, "studio://tests.prompt.yaml", null, parsed.runtimePreview);
  useStudioStore.setState(next);
}

// Keep sample data available for targeted test setup.
export const STUDIO_SAMPLE_PROMPT_YAML = SAMPLE_PROMPT_YAML;
