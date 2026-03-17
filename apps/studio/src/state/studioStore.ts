import { applyEdgeChanges, applyNodeChanges, type EdgeChange, type NodeChange } from "@xyflow/react";
import {
  buildScopedLlmPrompt,
  cancelNodeExecutionRecord,
  completeNodeExecutionRecord,
  createInMemoryNodeExecutionRepository,
  createNodeExecutionRecord,
  requestNodeExecutionCancellation,
  type LlmMessage,
  type MessageTemplate,
  type NodeExecutionRepository,
  type NodeExecutionRecord,
  type NodeExecutionScope,
  type NodeRuntimeState,
  type Prompt,
  type PromptBlock,
} from "@promptfarm/core";
import YAML from "yaml";
import { create } from "zustand";
import { createStarterPrompt, type StarterArtifactChoice } from "../editor/goldenPath";
import { applyGraphIntentToPrompt } from "../graph/adapters/graphSync";
import { listCanvasSourceNodeIds, projectPromptToCanvas, type CanvasLayout, type CanvasNodePosition } from "../graph/adapters/projectPromptToCanvas";
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
  StudioGraphProposal,
  StudioNodeResultHistoryEntry,
  StudioNodeResultKind,
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
  warmPromptDependencyBundle,
} from "../runtime/createRuntimePreview";
import {
  createGraphProposalNodeOutput,
  createGeneratedNodeOutput,
  createPromptUnitOutput,
  createRenderedPromptPreview,
  resolveSelectedStudioScope,
} from "../runtime/scopeRuntime";
import { createAssembledRootPrompt } from "../runtime/effectivePrompt";
import {
  buildGraphProposalInstruction,
  buildGraphProposalUserPrompt,
  createGraphProposalFromResponse,
} from "../runtime/graphProposal";
import {
  buildMessageSuggestionInstruction,
  buildMessageSuggestionUserPrompt,
  createMessageSuggestionInputSignature,
  parseMessageSuggestionResponse,
} from "../runtime/messageSuggestion";
import { filterPromptByHiddenBlocks, listPromptBlocks } from "../model/promptTree";
import {
  areStudioNodeLlmSettingsEqual,
  clearPersistedStudioNodeLlmSettings,
  discoverStudioNodeLlmModels,
  getStudioNodeLlmPresetSettings,
  getInitialStudioNodeLlmSettings,
  isStudioNodeLlmUsingLocalOllama,
  normalizeStudioNodeLlmSettings,
  readStudioNodeLlmSettingsFromEnv,
  resolveStudioNodeLlmClient,
  type StudioNodeLlmModelDiscoveryResult,
  type StudioNodeLlmProfile,
  type StudioNodeLlmPresetId,
  type StudioNodeLlmSettings,
  writePersistedStudioNodeLlmSettings,
} from "../runtime/nodeLlmClient";
import {
  executeStudioRemoteLlm,
  fetchStudioRemoteExecutionRecord,
  isStudioRemoteExecutionEnabled,
  requestStudioRemoteExecutionCancellation,
} from "../runtime/studioExecutionRemote";
import { writeStudioPromptDocumentToRemote } from "../runtime/studioPromptDocumentRemote";
import {
  readAuthoritativePersistedStudioPromptRuntime,
  readPersistedStudioPromptRuntime,
  setStudioPersistenceAdapterForTests,
  writeAuthoritativePersistedStudioPromptRuntime,
  writePersistedStudioPromptRuntime,
  type PersistedStudioPromptRuntime,
} from "../runtime/studioPersistence";

type StudioNodeLlmProbeState = {
  status: "idle" | "testing" | "success" | "failure";
  message: string | null;
  output: string | null;
  provider: string | null;
  model: string | null;
  executionTimeMs: number | null;
  testedAt: number | null;
};

type StudioNodeLlmModelCatalogState = {
  status: "idle" | "loading" | "success" | "failure";
  message: string | null;
  models: string[];
  source: StudioNodeLlmModelDiscoveryResult["source"] | null;
  refreshedAt: number | null;
};

type StudioMessageSuggestionState = {
  status: "idle" | "generating" | "success" | "failure";
  targetRef: string | null;
  inputSignature: string | null;
  summary: string | null;
  suggestedMessages: MessageTemplate[];
  message: string | null;
  provider: string | null;
  model: string | null;
  executionTimeMs: number | null;
  generatedAt: number | null;
};

type StudioConsoleEvent = {
  eventId: string;
  status: "info" | "success" | "error";
  category: "text" | "structure" | "system";
  message: string;
  createdAt: number;
  scopeRef?: string;
  nodeId?: string;
};

type StudioNodeModelAssignments = Record<string, string[]>;
type StudioNodeModelExecutionMode = "merge" | "choose_best";
type StudioNodeModelStrategy = {
  mode: StudioNodeModelExecutionMode;
  mergeProfileId?: string;
  selectedWinnerProfileId?: string;
};
type StudioNodeModelStrategies = Record<string, StudioNodeModelStrategy>;
type StudioGraphProposals = Record<string, StudioGraphProposal>;
type StudioNodeResultHistory = Record<string, StudioNodeResultHistoryEntry[]>;
type StudioNodeExecutionMode = "text_result" | "graph_proposal";
const activeRemoteExecutionRecoveryControllers = new Map<string, AbortController>();
type StudioStoreSetter = (
  partial: StudioState | Partial<StudioState> | ((state: StudioState) => StudioState | Partial<StudioState>),
  replace?: boolean,
) => void;

function shouldFallbackToLocalStudioExecution(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Remote execution start failed (404") ||
    message.includes("Remote execution start failed (405") ||
    message.includes("Remote execution start failed (502") ||
    message.includes("Remote execution start failed (503") ||
    message.includes("Failed to fetch") ||
    message.includes("NetworkError") ||
    message.includes("Load failed")
  );
}

async function executeStudioLlmWithRemoteFallback(input: {
  executionId: string;
  promptId: string;
  nodeId: string;
  scope: NodeExecutionScope;
  sourceSnapshotHash: string;
  mode: "text" | "structure";
  profile: StudioNodeLlmProfile;
  messages: LlmMessage[];
  signal?: AbortSignal;
  onRemoteRecord?: (record: NodeExecutionRecord) => void;
  localExecute: () => Promise<{
    outputText: string;
    provider: string;
    model: string;
    finishReason?: string;
    executionTimeMs: number;
  }>;
}): Promise<{
  outputText: string;
  provider: string;
  model: string;
  finishReason?: string;
  executionTimeMs: number;
}> {
  if (!isStudioRemoteExecutionEnabled()) {
    return input.localExecute();
  }

  try {
    const remoteRecord = await executeStudioRemoteLlm({
      executionId: input.executionId,
      promptId: input.promptId,
      nodeId: input.nodeId,
      scope: input.scope,
      sourceSnapshotHash: input.sourceSnapshotHash,
      mode: input.mode,
      llm: input.profile.settings,
      messages: input.messages,
      ...(input.onRemoteRecord ? { onRecord: input.onRemoteRecord } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });

    if (remoteRecord.status === "cancelled") {
      throw new DOMException("Aborted", "AbortError");
    }

    if (remoteRecord.status === "error") {
      throw new Error(remoteRecord.errorMessage ?? "Remote execution failed.");
    }

    if (remoteRecord.status !== "success" || typeof remoteRecord.output !== "string") {
      throw new Error(`Remote execution "${remoteRecord.executionId}" did not finish successfully.`);
    }

    return {
      outputText: remoteRecord.output,
      provider: remoteRecord.provider ?? (input.profile.settings.providerLabel || "openai_compatible"),
      model: remoteRecord.model ?? input.profile.settings.model,
      ...(remoteRecord.finishReason ? { finishReason: remoteRecord.finishReason } : {}),
      executionTimeMs: remoteRecord.executionTimeMs ?? 0,
    };
  } catch (error) {
    if (!shouldFallbackToLocalStudioExecution(error)) {
      throw error;
    }
    return input.localExecute();
  }
}

type TypedLlmRetryKind = "text" | "structure" | "messages";

function describeTypedLlmOutput(kind: TypedLlmRetryKind): string {
  if (kind === "structure") {
    return "a valid PromptFarm structure proposal JSON object with a non-empty blocks array";
  }
  if (kind === "messages") {
    return "a valid PromptFarm message suggestion JSON object with usable canonical messages";
  }
  return "plain non-empty text content";
}

function ensureTypedTextOutput(result: {
  outputText: string;
  provider: string;
  model: string;
  finishReason?: string;
  executionTimeMs: number;
}): string {
  if (!result.outputText.trim()) {
    throw new Error("Text generation response did not include usable text.");
  }

  return result.outputText;
}

function shouldRetryTypedLlmOutput(kind: TypedLlmRetryKind, error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  if (kind === "text") {
    return /did not include generated text|did not include usable text/i.test(message);
  }

  if (kind === "messages") {
    return /Message suggestion response|Suggested message/i.test(message);
  }

  return /Graph proposal response|Graph proposal block/i.test(message);
}

function buildTypedLlmRetryMessages(
  messages: LlmMessage[],
  kind: TypedLlmRetryKind,
  error: unknown,
  attempt: number,
): LlmMessage[] {
  const reason = error instanceof Error ? error.message : String(error);
  return [
    ...messages,
    {
      role: "developer",
      content: [
        `Your previous response did not match the expected type for ${kind} generation.`,
        `Expected output: ${describeTypedLlmOutput(kind)}.`,
        `Validation failure: ${reason}`,
        "Regenerate the full response from scratch and return only the expected output format.",
      ].join("\n"),
    },
    {
      role: "user",
      content: `Retry attempt ${attempt + 1}: regenerate the response so it matches the expected output type exactly.`,
    },
  ];
}

async function executeStudioTypedLlmWithRetries<T>(input: {
  kind: TypedLlmRetryKind;
  messages: LlmMessage[];
  execute: (attempt: number, messages: LlmMessage[]) => Promise<{
    outputText: string;
    provider: string;
    model: string;
    finishReason?: string;
    executionTimeMs: number;
  }>;
  parse: (result: {
    outputText: string;
    provider: string;
    model: string;
    finishReason?: string;
    executionTimeMs: number;
  }) => T;
  onRetry?: (input: { attempt: number; errorMessage: string }) => void;
  maxAttempts?: number;
}): Promise<{
  result: {
    outputText: string;
    provider: string;
    model: string;
    finishReason?: string;
    executionTimeMs: number;
  };
  parsed: T;
}> {
  const maxAttempts = input.maxAttempts ?? 2;
  let attemptMessages = input.messages;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await input.execute(attempt, attemptMessages);
      const parsed = input.parse(result);
      return { result, parsed };
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts - 1 || !shouldRetryTypedLlmOutput(input.kind, error)) {
        throw error;
      }

      input.onRetry?.({
        attempt: attempt + 2,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      attemptMessages = buildTypedLlmRetryMessages(input.messages, input.kind, error, attempt + 1);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? `Unknown ${input.kind} generation failure.`));
}

function scopeRefFromExecutionRecord(prompt: Prompt, record: NodeExecutionRecord): string {
  return record.scope.mode === "root" ? `root:${prompt.metadata.id}` : `block:${record.scope.blockId}`;
}

function sourceNodeIdFromExecutionRecord(prompt: Prompt, record: NodeExecutionRecord): string {
  return record.scope.mode === "root" ? `prompt:${prompt.metadata.id}` : `block:${record.scope.blockId}`;
}

function hasHistoryEntryForExecution(
  history: StudioNodeResultHistory,
  nodeId: string,
  executionId: string,
): boolean {
  return (history[nodeId] ?? []).some((entry) => entry.executionId === executionId);
}

function sanitizePersistedStudioPromptRuntimeForPrompt(
  prompt: Prompt,
  persisted: PersistedStudioPromptRuntime,
  input?: {
    preserveActiveExecutions?: boolean;
  },
): PersistedStudioPromptRuntime {
  const preserveActiveExecutions = input?.preserveActiveExecutions ?? false;
  const nextExecutionRecords = preserveActiveExecutions
    ? persisted.nodeExecutionRecords
    : settlePersistedExecutionRecords(persisted.nodeExecutionRecords);
  const nextRuntimeStates = preserveActiveExecutions
    ? persisted.nodeRuntimeStates
    : settlePersistedNodeRuntimeStates(persisted.nodeRuntimeStates);

  return {
    ...persisted,
    latestScopeOutputs: sanitizeLatestScopeOutputsForPrompt(prompt, persisted.latestScopeOutputs),
    graphProposals: sanitizeGraphProposalsForGraph(persisted.graphProposals, listCanvasSourceNodeIds(prompt)),
    nodeResultHistory: sanitizeNodeResultHistoryForPrompt(prompt, persisted.nodeResultHistory),
    nodeRuntimeStates: createNodeRuntimeStates(prompt, nextRuntimeStates),
    nodeExecutionRecords: nextExecutionRecords,
  };
}

function applyRecoveredExecutionRecordToState(input: {
  state: StudioState;
  prompt: Prompt;
  record: NodeExecutionRecord;
}): Partial<StudioState> {
  const runtimeNodeId = input.record.nodeId;
  const currentRuntimeState = input.state.nodeRuntimeStates[runtimeNodeId];
  if (!currentRuntimeState) {
    return {};
  }

  const nextRuntimeStates = { ...input.state.nodeRuntimeStates };
  const nextExecutionRecords = {
    ...input.state.nodeExecutionRecords,
    [input.record.executionId]: input.record,
  };
  const nextLatestScopeOutputs = { ...input.state.latestScopeOutputs };
  let nextGraphProposals = input.state.graphProposals;
  let nextNodeResultHistory = input.state.nodeResultHistory;
  const executedAt = input.record.completedAt ?? new Date();

  if (input.record.status === "running") {
    nextRuntimeStates[runtimeNodeId] = {
      ...currentRuntimeState,
      status: "running",
      activeExecutionId: input.record.executionId,
      startedAt: input.record.startedAt,
      upstreamSnapshotHash: input.record.sourceSnapshotHash,
    };
    return {
      nodeRuntimeStates: nextRuntimeStates,
      nodeExecutionRecords: nextExecutionRecords,
    };
  }

  if (input.record.status === "cancel_requested") {
    nextRuntimeStates[runtimeNodeId] = markRuntimeStateCancelRequested(
      {
        ...currentRuntimeState,
        activeExecutionId: input.record.executionId,
        startedAt: input.record.startedAt,
        upstreamSnapshotHash: input.record.sourceSnapshotHash,
      },
      input.record.cancelRequestedAt ?? new Date(),
    );
    return {
      nodeRuntimeStates: nextRuntimeStates,
      nodeExecutionRecords: nextExecutionRecords,
    };
  }

  if (input.record.status === "cancelled") {
    nextRuntimeStates[runtimeNodeId] = cancelRuntimeState(
      {
        ...currentRuntimeState,
        activeExecutionId: input.record.executionId,
      },
      input.record.executionId,
    );
    return {
      nodeRuntimeStates: nextRuntimeStates,
      nodeExecutionRecords: nextExecutionRecords,
    };
  }

  if (input.record.status === "error") {
    nextRuntimeStates[runtimeNodeId] = completeRuntimeState(
      {
        ...currentRuntimeState,
        activeExecutionId: input.record.executionId,
      },
      input.record.executionId,
      executedAt,
      "error",
      input.record.errorMessage,
    );
    return {
      nodeRuntimeStates: nextRuntimeStates,
      nodeExecutionRecords: nextExecutionRecords,
    };
  }

  nextRuntimeStates[runtimeNodeId] = completeRuntimeState(
    {
      ...currentRuntimeState,
      activeExecutionId: input.record.executionId,
    },
    input.record.executionId,
    executedAt,
    "success",
    input.record.output,
  );

  if (input.record.mode === "structure" && typeof input.record.output === "string") {
    const existingProposal =
      Object.values(input.state.graphProposals).find((proposal) => proposal.executionId === input.record.executionId) ?? null;
    const proposalId = existingProposal?.proposalId ?? createGraphProposalId();
    const recoveredScopeDescriptor = createRenderedPromptPreview(
      input.prompt,
      input.record.scope,
      input.record.sourceSnapshotHash,
    ).scope;
    const proposal = createGraphProposalFromResponse({
      prompt: input.prompt,
      scope: recoveredScopeDescriptor,
      sourceNodeId: sourceNodeIdFromExecutionRecord(input.prompt, input.record),
      sourceRuntimeNodeId: runtimeNodeId,
      proposalId,
      executionId: input.record.executionId,
      responseText: input.record.output,
    });
    const latestOutput = createGraphProposalNodeOutput({
      prompt: input.prompt,
      scope: input.record.scope,
      sourceSnapshotHash: input.record.sourceSnapshotHash,
      proposal,
      metadata: {
        executionId: input.record.executionId,
        provider: input.record.provider,
        model: input.record.model,
        executionTimeMs: input.record.executionTimeMs,
      },
    });
    nextLatestScopeOutputs[scopeRefFromExecutionRecord(input.prompt, input.record)] = latestOutput;
    nextGraphProposals = {
      ...Object.fromEntries(
        Object.entries(input.state.graphProposals).filter(
          ([, existingProposal]) =>
            !(
              (existingProposal.sourceRuntimeNodeId === runtimeNodeId && existingProposal.status === "preview") ||
              existingProposal.executionId === input.record.executionId
            ),
        ),
      ),
      [proposalId]: proposal,
    };

    if (!hasHistoryEntryForExecution(nextNodeResultHistory, runtimeNodeId, input.record.executionId)) {
      nextNodeResultHistory = appendNodeResultHistoryEntry(
        nextNodeResultHistory,
        createNodeResultHistoryEntry({
          nodeId: runtimeNodeId,
          executionId: input.record.executionId,
          resultKind: "graph_proposal",
          output: latestOutput,
        }),
      );
    }
  } else if (typeof input.record.output === "string") {
    const latestOutput = createGeneratedNodeOutput({
      prompt: input.prompt,
      scope: input.record.scope,
      sourceSnapshotHash: input.record.sourceSnapshotHash,
      content: input.record.output,
      metadata: {
        executionId: input.record.executionId,
        provider: input.record.provider,
        model: input.record.model,
        executionTimeMs: input.record.executionTimeMs,
      },
    });
    nextLatestScopeOutputs[scopeRefFromExecutionRecord(input.prompt, input.record)] = latestOutput;

    if (!hasHistoryEntryForExecution(nextNodeResultHistory, runtimeNodeId, input.record.executionId)) {
      nextNodeResultHistory = appendNodeResultHistoryEntry(
        nextNodeResultHistory,
        createNodeResultHistoryEntry({
          nodeId: runtimeNodeId,
          executionId: input.record.executionId,
          resultKind: "text_result",
          output: latestOutput,
        }),
      );
    }

    const target: RuntimeNodeTarget =
      input.record.scope.mode === "root"
        ? { kind: "prompt", runtimeNodeId, scope: input.record.scope }
        : { kind: "block", runtimeNodeId, blockId: input.record.scope.blockId, scope: input.record.scope };
    const staleDescendantIds = listStaleDescendantNodeIds(input.prompt, target);
    staleDescendantIds.forEach((descendantNodeId) => {
      const descendantState = nextRuntimeStates[descendantNodeId];
      if (!descendantState || descendantState.status === "idle") {
        return;
      }
      nextRuntimeStates[descendantNodeId] = {
        ...clearActiveRuntimeFields(descendantState),
        status: "stale",
      };
    });
  }

  return {
    nodeRuntimeStates: nextRuntimeStates,
    nodeExecutionRecords: nextExecutionRecords,
    latestScopeOutputs: nextLatestScopeOutputs,
    graphProposals: nextGraphProposals,
    nodeResultHistory: nextNodeResultHistory,
  };
}

async function recoverRemoteExecutionsForPrompt(input: {
  get: () => StudioState;
  set: StudioStoreSetter;
  promptId: string;
}): Promise<void> {
  if (!isStudioRemoteExecutionEnabled()) {
    return;
  }

  const initialState = input.get();
  if (!initialState.canonicalPrompt || initialState.canonicalPrompt.metadata.id !== input.promptId) {
    return;
  }

  const activeRecords = Object.values(initialState.nodeExecutionRecords).filter(
    (record) =>
      record.promptId === input.promptId &&
      (record.status === "running" || record.status === "cancel_requested"),
  );

  await Promise.all(
    activeRecords.map(async (record) => {
      if (activeNodeExecutionHandles.get(record.nodeId)?.executionId === record.executionId) {
        return;
      }
      if (activeRemoteExecutionRecoveryControllers.has(record.executionId)) {
        return;
      }

      const controller = new AbortController();
      activeRemoteExecutionRecoveryControllers.set(record.executionId, controller);

      try {
        for (;;) {
          if (controller.signal.aborted) {
            return;
          }

          const latest = await fetchStudioRemoteExecutionRecord(record.executionId);
          const currentState = input.get();
          if (!currentState.canonicalPrompt || currentState.canonicalPrompt.metadata.id !== input.promptId) {
            controller.abort();
            return;
          }

          if (!latest) {
            input.set((state) => {
              const currentRecord = state.nodeExecutionRecords[record.executionId];
              if (!currentRecord) {
                return {};
              }
              const cancelledRecord = cancelNodeExecutionRecord(
                requestNodeExecutionCancellation(currentRecord, new Date()),
                new Date(),
              );
              nodeExecutionRepository.put(cancelledRecord);
              return applyRecoveredExecutionRecordToState({
                state,
                prompt: currentState.canonicalPrompt!,
                record: cancelledRecord,
              });
            });
            return;
          }

          nodeExecutionRepository.put(latest);
          input.set((state) => {
            if (!state.canonicalPrompt || state.canonicalPrompt.metadata.id !== input.promptId) {
              return {};
            }
            return applyRecoveredExecutionRecordToState({
              state,
              prompt: state.canonicalPrompt,
              record: latest,
            });
          });

          if (latest.status !== "running" && latest.status !== "cancel_requested") {
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      } finally {
        activeRemoteExecutionRecoveryControllers.delete(record.executionId);
      }
    }),
  );
}

type StudioState = {
  canonicalPrompt: Prompt | null;
  savedPrompt: Prompt | null;
  savedPromptDigest: string | null;
  sourceLabel: string;
  currentProjectId: string | null;
  currentProjectName: string | null;
  paletteFocusKind: StudioNodeKind | null;
  focusedBlockId: string | null;
  canvasLayout: CanvasLayout;
  mindMapNodePositions: Record<string, CanvasNodePosition>;
  collapsedBlockIds: string[];
  hiddenBlockIds: string[];
  hiddenDependencyPromptIds: string[];

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
  selectedProposalNodeId: string | null;
  activeEditorRef: string | null;
  editorDrafts: Record<string, EditorDraftSession>;
  runtimePreview: StudioRuntimePreview;
  selectedScopePromptPreview: StudioRenderedPromptPreview | null;
  latestScopeOutputs: Record<string, StudioPromptUnitOutput>;
  nodeLlmProfiles: Record<string, StudioNodeLlmProfile>;
  nodeLlmProfileOrder: string[];
  nodeLlmSettings: StudioNodeLlmSettings;
  nodeLlmProbe: StudioNodeLlmProbeState;
  nodeLlmModelCatalog: StudioNodeLlmModelCatalogState;
  messageSuggestion: StudioMessageSuggestionState;
  consoleEvents: StudioConsoleEvent[];
  nodeModelAssignments: StudioNodeModelAssignments;
  nodeModelStrategies: StudioNodeModelStrategies;
  graphProposals: StudioGraphProposals;
  nodeResultHistory: StudioNodeResultHistory;
  nodeRuntimeStates: Record<string, NodeRuntimeState>;
  nodeExecutionRecords: Record<string, NodeExecutionRecord>;

  setYamlText: (next: string) => void;
  loadPromptYaml: (yamlText: string, sourceLabel?: string) => void;
  hydratePromptDocument: (
    prompt: Prompt,
    sourceLabel?: string,
    projectContext?: { projectId?: string | null; projectName?: string | null },
  ) => void;
  createStarterPrompt: (artifactType: StarterArtifactChoice) => void;
  importFromYaml: () => void;
  savePrompt: () => { filename: string; yamlText: string } | null;
  resetToSaved: () => void;
  refreshRuntimePreview: () => void;
  refreshSelectedScopePromptPreview: () => void;
  runRuntimeAction: (action: StudioRuntimeAction) => void;
  runFocusedBlockRuntimeAction: (action: Exclude<StudioRuntimeAction, "build">) => void;
  runSelectedScopeRuntimeAction: (action: StudioRuntimeAction) => void;
  applyNodeLlmPreset: (presetId: StudioNodeLlmPresetId) => void;
  saveNodeLlmProfile: (input: { profileId?: string; name: string }) => string | null;
  loadNodeLlmProfileIntoEditor: (profileId: string) => void;
  deleteNodeLlmProfile: (profileId: string) => void;
  setNodeLlmSettings: (patch: Partial<StudioNodeLlmSettings>) => void;
  selectNodeLlmModel: (model: string) => void;
  resetNodeLlmSettings: () => void;
  refreshNodeLlmModels: () => Promise<void>;
  testNodeLlmConnection: () => Promise<void>;
  testNodeLlmConnectionAndRunSelectedNode: () => Promise<void>;
  suggestMessagesForActiveDraft: () => Promise<void>;
  applyMessageSuggestionToActiveDraft: () => void;
  clearMessageSuggestion: () => void;
  setNodeModelAssignments: (nodeId: string, profileIds: string[]) => void;
  clearNodeModelAssignments: (nodeId: string) => void;
  setNodeModelStrategy: (nodeId: string, patch: Partial<StudioNodeModelStrategy>) => void;
  clearNodeModelStrategy: (nodeId: string) => void;
  selectNodeModelWinner: (nodeId: string, profileId: string) => void;
  generateNodeGraphProposal: (nodeId: string) => void;
  applyGraphProposal: (proposalId: string) => void;
  rejectGraphProposal: (proposalId: string) => void;
  applyAllNodeGraphProposals: (sourceRuntimeNodeId: string) => void;
  rejectAllNodeGraphProposals: (sourceRuntimeNodeId: string) => void;
  restoreNodeResultHistoryEntry: (nodeId: string, historyEntryId: string) => void;
  recoverRemoteRuntimeForCurrentPrompt: () => Promise<void>;
  clearWorkspace: () => void;
  setSelectedNodeId: (id: string | null) => void;
  setSelectedProposalNodeId: (id: string | null) => void;
  clearSyncIssues: () => void;
  updateActiveEditorDraft: (draft: EditorDraft) => void;
  applyActiveEditorDraft: () => void;
  resetActiveEditorDraft: () => void;
  selectFirstNodeByKind: (kind: StudioNodeKind) => void;
  focusBlock: (blockId: string | null) => void;
  setCanvasLayout: (layout: CanvasLayout) => void;
  toggleBlockCollapsed: (blockId: string) => void;
  toggleBlockHidden: (blockId: string) => void;
  toggleDependencyHidden: (promptId: string) => void;
  attachPromptDependency: (promptId: string) => void;
  detachPromptDependency: (promptId: string) => void;
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
  selectedProposalNodeId: string | null;
  activeEditorRef: string | null;
  editorDrafts: Record<string, EditorDraftSession>;
  focusedBlockId: string | null;
  mindMapNodePositions: Record<string, CanvasNodePosition>;
  hiddenBlockIds: string[];
  hiddenDependencyPromptIds: string[];
  runtimePreview: StudioRuntimePreview;
  selectedScopePromptPreview: StudioRenderedPromptPreview | null;
  latestScopeOutputs: Record<string, StudioPromptUnitOutput>;
  graphProposals: StudioGraphProposals;
  nodeResultHistory: StudioNodeResultHistory;
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
let nextNodeLlmProbeSequence = 1;
let nextNodeLlmProfileSequence = 1;
let nextGraphProposalSequence = 1;
let nextNodeResultHistorySequence = 1;
let nextMessageSuggestionSequence = 1;
let nextConsoleEventSequence = 1;

function getPromptRuntimeNodeId(prompt: Prompt): string {
  return `prompt_root_${prompt.metadata.id}`;
}

function createExecutionId(): string {
  const executionId = `node_exec_${nextNodeExecutionSequence}`;
  nextNodeExecutionSequence += 1;
  return executionId;
}

function createGraphProposalId(): string {
  const proposalId = `graph_proposal_${nextGraphProposalSequence}`;
  nextGraphProposalSequence += 1;
  return proposalId;
}

function createNodeResultHistoryId(): string {
  const historyEntryId = `node_history_${nextNodeResultHistorySequence}`;
  nextNodeResultHistorySequence += 1;
  return historyEntryId;
}

function emptyNodeLlmProbeState(): StudioNodeLlmProbeState {
  return {
    status: "idle",
    message: null,
    output: null,
    provider: null,
    model: null,
    executionTimeMs: null,
    testedAt: null,
  };
}

function emptyNodeLlmModelCatalogState(): StudioNodeLlmModelCatalogState {
  return {
    status: "idle",
    message: null,
    models: [],
    source: null,
    refreshedAt: null,
  };
}

function emptyMessageSuggestionState(): StudioMessageSuggestionState {
  return {
    status: "idle",
    targetRef: null,
    inputSignature: null,
    summary: null,
    suggestedMessages: [],
    message: null,
    provider: null,
    model: null,
    executionTimeMs: null,
    generatedAt: null,
  };
}

function createConsoleEvent(input: {
  status: StudioConsoleEvent["status"];
  category: StudioConsoleEvent["category"];
  message: string;
  scopeRef?: string;
  nodeId?: string;
}): StudioConsoleEvent {
  const eventId = `console_event_${nextConsoleEventSequence}`;
  nextConsoleEventSequence += 1;
  return {
    eventId,
    status: input.status,
    category: input.category,
    message: input.message,
    createdAt: Date.now(),
    ...(input.scopeRef ? { scopeRef: input.scopeRef } : {}),
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
  };
}

function appendConsoleEvent(
  events: StudioConsoleEvent[],
  event: StudioConsoleEvent,
  maxEvents = 60,
): StudioConsoleEvent[] {
  const nextEvents = [...events, event];
  return nextEvents.length > maxEvents ? nextEvents.slice(nextEvents.length - maxEvents) : nextEvents;
}

function createNodeLlmProfileId(): string {
  const profileId = `llm_profile_${nextNodeLlmProfileSequence}`;
  nextNodeLlmProfileSequence += 1;
  return profileId;
}

function createInitialNodeLlmProfiles(): { profiles: Record<string, StudioNodeLlmProfile>; order: string[] } {
  const profiles: Record<string, StudioNodeLlmProfile> = {};
  const order: string[] = [];
  const localOllamaProfileId = createNodeLlmProfileId();
  const localOllamaSettings = getStudioNodeLlmPresetSettings("ollama_local", normalizeStudioNodeLlmSettings({}));
  profiles[localOllamaProfileId] = {
    id: localOllamaProfileId,
    name: "Ollama Local",
    settings: localOllamaSettings,
  };
  order.push(localOllamaProfileId);

  const envSettings = readStudioNodeLlmSettingsFromEnv();
  if (
    envSettings.baseUrl &&
    envSettings.model &&
    !areStudioNodeLlmSettingsEqual(envSettings, localOllamaSettings)
  ) {
    const profileId = createNodeLlmProfileId();
    profiles[profileId] = {
      id: profileId,
      name: "Environment Default",
      settings: envSettings,
    };
    order.push(profileId);
  }

  return { profiles, order };
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

function listPromptScopeRefs(prompt: Prompt): string[] {
  return [`root:${prompt.metadata.id}`, ...listPromptBlockIds(prompt.spec.blocks).map((blockId) => `block:${blockId}`)];
}

function sanitizeHiddenBlockIdsForPrompt(prompt: Prompt, hiddenBlockIds: string[]): string[] {
  const availableIds = new Set(listPromptBlockIds(prompt.spec.blocks));
  return hiddenBlockIds.filter((blockId) => availableIds.has(blockId));
}

function sanitizeHiddenDependencyPromptIdsForPrompt(prompt: Prompt, hiddenDependencyPromptIds: string[]): string[] {
  const availableIds = new Set(prompt.spec.use.map((dep) => dep.prompt));
  return hiddenDependencyPromptIds.filter((promptId) => availableIds.has(promptId));
}

function sanitizeLatestScopeOutputsForPrompt(
  prompt: Prompt,
  outputs: Record<string, StudioPromptUnitOutput>,
): Record<string, StudioPromptUnitOutput> {
  const validScopeRefs = new Set(listPromptScopeRefs(prompt));
  return Object.fromEntries(
    Object.entries(outputs).filter(([scopeRef]) => validScopeRefs.has(scopeRef)),
  );
}

function sanitizeNodeResultHistoryForPrompt(
  prompt: Prompt,
  history: StudioNodeResultHistory,
): StudioNodeResultHistory {
  const validRuntimeNodeIds = new Set(listPromptRuntimeNodeIds(prompt));
  const validScopeRefs = new Set(listPromptScopeRefs(prompt));
  return Object.fromEntries(
    Object.entries(history)
      .filter(([nodeId]) => validRuntimeNodeIds.has(nodeId))
      .map(([nodeId, entries]) => [
        nodeId,
        entries.filter((entry) => validScopeRefs.has(entry.output.scope.scopeRef)),
      ])
      .filter(([, entries]) => entries.length > 0),
  );
}

function settlePersistedNodeRuntimeStates(
  states: Record<string, NodeRuntimeState>,
): Record<string, NodeRuntimeState> {
  return Object.fromEntries(
    Object.entries(states).map(([nodeId, state]) => {
      if (state.status !== "running") {
        return [nodeId, state];
      }
      return [
        nodeId,
        {
          ...clearActiveRuntimeFields(state),
          status: state.lastRunAt || state.output ? ("stale" as const) : ("idle" as const),
        },
      ];
    }),
  );
}

function settlePersistedExecutionRecords(
  records: Record<string, NodeExecutionRecord>,
  completedAt: Date = new Date(),
): Record<string, NodeExecutionRecord> {
  return Object.fromEntries(
    Object.entries(records).map(([executionId, record]) => [
      executionId,
      isExecutionRecordActive(record)
        ? cancelNodeExecutionRecord(requestNodeExecutionCancellation(record, completedAt), completedAt)
        : record,
    ]),
  );
}

function syncSequenceCountersFromPersistedRuntime(input: PersistedStudioPromptRuntime): void {
  const updateFromIds = (ids: string[], prefix: string, getCurrent: () => number, setNext: (value: number) => void) => {
    let nextValue = getCurrent();
    for (const id of ids) {
      const match = id.match(new RegExp(`^${prefix}_(\\d+)$`));
      const numeric = match ? Number.parseInt(match[1] ?? "", 10) : Number.NaN;
      if (!Number.isNaN(numeric)) {
        nextValue = Math.max(nextValue, numeric + 1);
      }
    }
    setNext(nextValue);
  };

  updateFromIds(
    Object.keys(input.nodeExecutionRecords),
    "node_exec",
    () => nextNodeExecutionSequence,
    (value) => {
      nextNodeExecutionSequence = value;
    },
  );
  updateFromIds(
    Object.keys(input.graphProposals),
    "graph_proposal",
    () => nextGraphProposalSequence,
    (value) => {
      nextGraphProposalSequence = value;
    },
  );
  updateFromIds(
    Object.values(input.nodeResultHistory).flatMap((entries) => entries.map((entry) => entry.historyEntryId)),
    "node_history",
    () => nextNodeResultHistorySequence,
    (value) => {
      nextNodeResultHistorySequence = value;
    },
  );
}

function resolvePersistedStudioPromptRuntime(prompt: Prompt): PersistedStudioPromptRuntime | null {
  const persisted = readPersistedStudioPromptRuntime(prompt.metadata.id);
  if (!persisted) {
    return null;
  }

  const sanitized = sanitizePersistedStudioPromptRuntimeForPrompt(prompt, persisted, {
    preserveActiveExecutions: isStudioRemoteExecutionEnabled(),
  });

  nodeExecutionRepository.pruneToPrompt(prompt.metadata.id, []);
  nodeExecutionRepository.putMany(Object.values(sanitized.nodeExecutionRecords));
  syncSequenceCountersFromPersistedRuntime(sanitized);
  writePersistedStudioPromptRuntime(sanitized);

  return sanitized;
}

function sanitizeNodeModelAssignments(
  assignments: StudioNodeModelAssignments,
  availableProfileIds: Set<string>,
): StudioNodeModelAssignments {
  return Object.fromEntries(
    Object.entries(assignments)
      .map(([nodeId, profileIds]) => [nodeId, profileIds.filter((profileId) => availableProfileIds.has(profileId))] as const)
      .filter(([, profileIds]) => profileIds.length > 0),
  );
}

function ensureDefaultNodeModelAssignments(input: {
  prompt: Prompt;
  assignments: StudioNodeModelAssignments;
  profiles: Record<string, StudioNodeLlmProfile>;
  profileOrder: string[];
}): StudioNodeModelAssignments {
  if (input.profileOrder.length === 0) {
    return input.assignments;
  }

  const rootRuntimeNodeId = getPromptRuntimeNodeId(input.prompt);
  if ((input.assignments[rootRuntimeNodeId] ?? []).length > 0) {
    return input.assignments;
  }

  const preferredProfileId =
    input.profileOrder.find((profileId) => {
      const profile = input.profiles[profileId];
      return profile ? isStudioNodeLlmUsingLocalOllama(profile.settings) : false;
    }) ?? input.profileOrder[0];

  return preferredProfileId
    ? {
        ...input.assignments,
        [rootRuntimeNodeId]: [preferredProfileId],
      }
    : input.assignments;
}

function sanitizeNodeModelStrategies(
  strategies: StudioNodeModelStrategies,
  availableProfileIds: Set<string>,
): StudioNodeModelStrategies {
  return Object.fromEntries(
    Object.entries(strategies).map(([nodeId, strategy]) => [
      nodeId,
      {
        mode: strategy.mode,
        ...(strategy.mergeProfileId && availableProfileIds.has(strategy.mergeProfileId)
          ? { mergeProfileId: strategy.mergeProfileId }
          : {}),
        ...(strategy.selectedWinnerProfileId && availableProfileIds.has(strategy.selectedWinnerProfileId)
          ? { selectedWinnerProfileId: strategy.selectedWinnerProfileId }
          : {}),
      },
    ]),
  );
}

function resolveEffectiveNodeModelProfileIds(input: {
  prompt: Prompt;
  target: RuntimeNodeTarget;
  nodeModelAssignments: StudioNodeModelAssignments;
}): string[] {
  const rootRuntimeNodeId = getPromptRuntimeNodeId(input.prompt);

  if (input.target.kind === "prompt") {
    return input.nodeModelAssignments[rootRuntimeNodeId] ?? [];
  }

  const path = findBlockPathById(input.prompt.spec.blocks, input.target.blockId);
  const runtimeNodeIds = [input.target.blockId, ...path.slice(0, -1).reverse().map((block) => block.id), rootRuntimeNodeId];
  for (const runtimeNodeId of runtimeNodeIds) {
    const assignedProfileIds = input.nodeModelAssignments[runtimeNodeId];
    if (assignedProfileIds && assignedProfileIds.length > 0) {
      return assignedProfileIds;
    }
  }

  return [];
}

function resolveEffectiveNodeModelStrategy(input: {
  prompt: Prompt;
  target: RuntimeNodeTarget;
  nodeModelStrategies: StudioNodeModelStrategies;
}): StudioNodeModelStrategy {
  const rootRuntimeNodeId = getPromptRuntimeNodeId(input.prompt);

  if (input.target.kind === "prompt") {
    return input.nodeModelStrategies[rootRuntimeNodeId] ?? { mode: "choose_best" };
  }

  const path = findBlockPathById(input.prompt.spec.blocks, input.target.blockId);
  const runtimeNodeIds = [input.target.blockId, ...path.slice(0, -1).reverse().map((block) => block.id), rootRuntimeNodeId];
  for (const runtimeNodeId of runtimeNodeIds) {
    const strategy = input.nodeModelStrategies[runtimeNodeId];
    if (strategy) {
      return strategy;
    }
  }

  return { mode: "choose_best" };
}

function resolveMessageSuggestionInput(
  prompt: Prompt,
  selection: EditorSelection,
  draft: EditorDraft,
): {
  targetRef: string;
  inputSignature: string;
  artifactType: Prompt["spec"]["artifact"]["type"];
  entityKind: "prompt" | "block";
  title: string;
  description: string;
  promptSource: string;
  variableNames: string[];
  sourceMode: "title_description" | "prompt_source";
  blockKind?: PromptBlock["kind"];
  runtimeTarget: RuntimeNodeTarget;
} | null {
  if (selection.kind === "use_prompt") {
    return null;
  }

  if (draft.entityKind === "prompt" && selection.kind === "prompt") {
    const promptSource = draft.messages
      .map((message) => `${message.role.toUpperCase()}:\n${message.content.trim()}`)
      .filter((message) => message.trim().length > 0)
      .join("\n\n");

    return {
      targetRef: selection.ref,
      inputSignature: createMessageSuggestionInputSignature({
        entityKind: "prompt",
        artifactType: prompt.spec.artifact.type,
        title: draft.title,
        description: draft.description,
        promptSource,
        variableNames: draft.inputs.map((input) => input.name),
      }),
      artifactType: prompt.spec.artifact.type,
      entityKind: "prompt",
      title: draft.title,
      description: draft.description,
      promptSource,
      variableNames: draft.inputs.map((input) => input.name),
      sourceMode: promptSource.trim().length > 0 ? "prompt_source" : "title_description",
      runtimeTarget: {
        kind: "prompt",
        runtimeNodeId: getPromptRuntimeNodeId(prompt),
        scope: { mode: "root" },
      },
    };
  }

  if (draft.entityKind === "block" && selection.kind === "block") {
    const promptSource = draft.messages
      .map((message) => `${message.role.toUpperCase()}:\n${message.content.trim()}`)
      .filter((message) => message.trim().length > 0)
      .join("\n\n");

    return {
      targetRef: selection.ref,
      inputSignature: createMessageSuggestionInputSignature({
        entityKind: "block",
        artifactType: prompt.spec.artifact.type,
        title: draft.title,
        description: draft.description,
        promptSource,
        variableNames: draft.inputs.map((input) => input.name),
        blockKind: draft.blockKind,
      }),
      artifactType: prompt.spec.artifact.type,
      entityKind: "block",
      title: draft.title,
      description: draft.description,
      promptSource,
      variableNames: draft.inputs.map((input) => input.name),
      sourceMode: promptSource.trim().length > 0 ? "prompt_source" : "title_description",
      blockKind: draft.blockKind,
      runtimeTarget: {
        kind: "block",
        runtimeNodeId: selection.block.id,
        blockId: selection.block.id,
        scope: { mode: "block", blockId: selection.block.id },
      },
    };
  }

  return null;
}

function resolveMessageSuggestionLlmSettings(
  state: Pick<StudioState, "canonicalPrompt" | "nodeLlmProfiles" | "nodeLlmSettings" | "nodeModelAssignments" | "nodeModelStrategies">,
  runtimeTarget: RuntimeNodeTarget,
): StudioNodeLlmSettings | null {
  if (!state.canonicalPrompt) {
    return null;
  }
  const effectiveProfileIds = resolveEffectiveNodeModelProfileIds({
    prompt: state.canonicalPrompt,
    target: runtimeTarget,
    nodeModelAssignments: state.nodeModelAssignments,
  });
  const effectiveStrategy = resolveEffectiveNodeModelStrategy({
    prompt: state.canonicalPrompt,
    target: runtimeTarget,
    nodeModelStrategies: state.nodeModelStrategies,
  });
  const effectiveProfiles = effectiveProfileIds
    .map((profileId) => state.nodeLlmProfiles[profileId])
    .filter((profile): profile is StudioNodeLlmProfile => Boolean(profile));
  const selectedProfile =
    (effectiveStrategy.mergeProfileId
      ? effectiveProfiles.find((profile) => profile.id === effectiveStrategy.mergeProfileId)
      : undefined) ?? effectiveProfiles[0];

  if (selectedProfile) {
    return selectedProfile.settings;
  }

  const fallbackSettings = normalizeStudioNodeLlmSettings(state.nodeLlmSettings);
  return fallbackSettings.baseUrl && fallbackSettings.model ? fallbackSettings : null;
}

function buildMultiModelOutput(executions: Array<{
  profileId: string;
  profileName: string;
  provider: string;
  model: string;
  executionTimeMs: number;
  outputText: string;
}>): string {
  if (executions.length === 1) {
    return executions[0]?.outputText ?? "";
  }

  return executions
    .map(
      (execution) =>
        `## ${execution.profileName}\nprovider=${execution.provider} model=${execution.model} latency=${execution.executionTimeMs}ms\n\n${execution.outputText}`,
    )
    .join("\n\n");
}

function createMergedCandidateSummary(executions: Array<{
  profileId: string;
  profileName: string;
  model: string;
  outputText: string;
}>): string[] {
  return executions.map(
    (execution) => `${execution.profileName} (${execution.model})\n${execution.outputText}`,
  );
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

function findBlockPathById(blocks: PromptBlock[], blockId: string, path: PromptBlock[] = []): PromptBlock[] {
  for (const block of blocks) {
    const nextPath = [...path, block];
    if (block.id === blockId) {
      return nextPath;
    }
    const nested = findBlockPathById(block.children, blockId, nextPath);
    if (nested.length > 0) {
      return nested;
    }
  }

  return [];
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

function listUpstreamNodeOutputs(
  prompt: Prompt,
  target: RuntimeNodeTarget,
  nodeRuntimeStates: Record<string, NodeRuntimeState>,
): string[] {
  if (target.kind !== "block") {
    return [];
  }

  return findBlockPathById(prompt.spec.blocks, target.blockId)
    .slice(0, -1)
    .map((block) => nodeRuntimeStates[block.id]?.output)
    .filter((output): output is string => typeof output === "string" && output.trim().length > 0);
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
  hiddenBlockIds: string[];
  hiddenDependencyPromptIds: string[];
  latestScopeOutputs: Record<string, StudioPromptUnitOutput>;
}): { selectedScopePromptPreview: StudioRenderedPromptPreview | null; latestScopeOutputs: Record<string, StudioPromptUnitOutput> } {
  const { canonicalPrompt, selectedNodeId, hiddenBlockIds, hiddenDependencyPromptIds, latestScopeOutputs } = input;
  if (!canonicalPrompt) {
    return createEmptyScopeRuntimeState();
  }

  const selectedBlockId = selectedNodeId?.startsWith("block:") ? selectedNodeId.replace("block:", "") : null;
  const promptForPreview = filterPromptByHiddenBlocks(
    canonicalPrompt,
    hiddenBlockIds,
    hiddenDependencyPromptIds,
    selectedBlockId,
  );
  const sourceSnapshotHash = digestPrompt(promptForPreview);
  const scope = resolveSelectedStudioScope(promptForPreview, selectedNodeId);
  return {
    selectedScopePromptPreview: createRenderedPromptPreview(promptForPreview, scope, sourceSnapshotHash),
    latestScopeOutputs,
  };
}

function createRuntimePromptSnapshot(
  prompt: Prompt,
  hiddenBlockIds: string[],
  hiddenDependencyPromptIds: string[],
  preserveBlockId?: string | null,
): Prompt {
  return filterPromptByHiddenBlocks(
    prompt,
    sanitizeHiddenBlockIdsForPrompt(prompt, hiddenBlockIds),
    sanitizeHiddenDependencyPromptIdsForPrompt(prompt, hiddenDependencyPromptIds),
    preserveBlockId,
  );
}

function createNodeResultHistoryEntry(input: {
  nodeId: string;
  executionId: string;
  resultKind: StudioNodeResultKind;
  output: StudioPromptUnitOutput;
}): StudioNodeResultHistoryEntry {
  return {
    historyEntryId: createNodeResultHistoryId(),
    nodeId: input.nodeId,
    executionId: input.executionId,
    resultKind: input.resultKind,
    output: input.output,
    createdAt: Date.now(),
    active: true,
  };
}

function appendNodeResultHistoryEntry(
  history: StudioNodeResultHistory,
  entry: StudioNodeResultHistoryEntry,
): StudioNodeResultHistory {
  return {
    ...history,
    [entry.nodeId]: [entry, ...(history[entry.nodeId] ?? []).map((existing) => ({ ...existing, active: false }))],
  };
}

function setActiveNodeResultHistoryEntry(
  history: StudioNodeResultHistory,
  nodeId: string,
  historyEntryId: string,
): StudioNodeResultHistory {
  const entries = history[nodeId];
  if (!entries) {
    return history;
  }
  return {
    ...history,
    [nodeId]: entries.map((entry) => ({
      ...entry,
      active: entry.historyEntryId === historyEntryId,
    })),
  };
}

function sanitizeGraphProposalsForGraph(
  proposals: StudioGraphProposals,
  availableNodeIds: Set<string>,
): StudioGraphProposals {
  return Object.fromEntries(
    Object.entries(proposals).filter(([, proposal]) => availableNodeIds.has(proposal.sourceNodeId) || proposal.status !== "preview"),
  );
}

function countPreviewGraphProposalsForRuntimeNode(
  proposals: StudioGraphProposals,
  sourceRuntimeNodeId: string,
): number {
  return Object.values(proposals).filter(
    (proposal) => proposal.sourceRuntimeNodeId === sourceRuntimeNodeId && proposal.status === "preview",
  ).length;
}

function proposalContainsNodeId(blocks: StudioGraphProposal["blocks"], proposalNodeId: string): boolean {
  return blocks.some(
    (block) => `proposal:${block.proposalNodeId}` === proposalNodeId || proposalContainsNodeId(block.children, proposalNodeId),
  );
}

function cloneProposalBlocksWithPrefix(
  blocks: StudioGraphProposal["blocks"],
  idPrefix: string,
  path: number[] = [],
): StudioGraphProposal["blocks"] {
  return blocks.map((block, index) => {
    const nextPath = [...path, index];
    return {
      ...block,
      proposalNodeId: `${idPrefix}_${nextPath.join("_")}`,
      parentProposalNodeId: nextPath.length > 1 ? `${idPrefix}_${nextPath.slice(0, -1).join("_")}` : null,
      children: cloneProposalBlocksWithPrefix(block.children, idPrefix, nextPath),
    };
  });
}

function applyGraphProposalToPrompt(input: {
  prompt: Prompt;
  focusedBlockId: string | null;
  proposal: StudioGraphProposal;
}): { ok: true; prompt: Prompt } | { ok: false; message: string } {
  let nextPrompt = clonePrompt(input.prompt);
  let currentGraph = projectPromptToCanvas(nextPrompt, {
    layout: "org_chart",
  });

  function walk(blocks: StudioGraphProposal["blocks"], parentBlockId: string | null): { ok: true } | { ok: false; message: string } {
    for (const block of blocks) {
      const beforeIds = new Set(listPromptBlocks(nextPrompt.spec.blocks).map((entry) => entry.block.id));
      const addResult = applyGraphIntentToPrompt(nextPrompt, currentGraph, {
        type: "block.add",
        kind: block.kind,
        parentBlockId,
      });
      if (!addResult.supported) {
        return {
          ok: false,
          message: addResult.issues.map((issue) => issue.message).join(" "),
        };
      }
      nextPrompt = addResult.prompt;
      currentGraph = projectPromptToCanvas(nextPrompt, {
        layout: "org_chart",
      });

      const addedBlockId = listPromptBlocks(nextPrompt.spec.blocks)
        .map((entry) => entry.block.id)
        .find((blockId) => !beforeIds.has(blockId));
      if (!addedBlockId) {
        return { ok: false, message: `Unable to resolve newly created block for proposal "${block.title}".` };
      }

      const patchResult = applyGraphIntentToPrompt(nextPrompt, currentGraph, {
        type: "block.patch",
        blockId: addedBlockId,
        changes: {
          title: block.title,
          description: block.description,
          messages: [
            {
              role: "user",
              content: block.instruction,
            },
          ],
        },
      });
      if (!patchResult.supported) {
        return {
          ok: false,
          message: patchResult.issues.map((issue) => issue.message).join(" "),
        };
      }

      nextPrompt = patchResult.prompt;
      currentGraph = projectPromptToCanvas(nextPrompt, {
        layout: "org_chart",
      });

      const nested = walk(block.children, addedBlockId);
      if (!nested.ok) {
        return nested;
      }
    }

    return { ok: true };
  }

  const rootParentBlockId = input.proposal.scope.mode === "block" ? input.proposal.scope.blockId ?? null : null;
  const applied = walk(input.proposal.blocks, rootParentBlockId);
  if (!applied.ok) {
    return applied;
  }

  return {
    ok: true,
    prompt: nextPrompt,
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

type ApplyActiveEditorDraftStateResult =
  | { ok: true; nextState: Partial<StudioState> }
  | { ok: false; nextState: Partial<StudioState>; message: string };

function applyActiveEditorDraftState(
  state: StudioState,
  options: { skipIfClean?: boolean } = {},
): ApplyActiveEditorDraftStateResult {
  if (!state.canonicalPrompt || !state.activeEditorRef) {
    return { ok: true, nextState: {} };
  }

  const selection = resolveEditorSelection({
    canonicalPrompt: state.canonicalPrompt,
    nodes: state.nodes,
    selectedNodeId: state.selectedNodeId,
    focusedBlockId: state.focusedBlockId,
  });
  if (!selection || selection.ref !== state.activeEditorRef) {
    const message = "Active editor session is out of sync with selection.";
    return {
      ok: false,
      message,
      nextState: {
        syncIssues: [message],
      },
    };
  }

  const session = state.editorDrafts[state.activeEditorRef];
  if (!session) {
    const message = "No active editor draft.";
    return {
      ok: false,
      message,
      nextState: {
        syncIssues: [message],
      },
    };
  }

  if (options.skipIfClean && !session.dirty) {
    return { ok: true, nextState: {} };
  }

  const intentResult = createApplyIntentForSelection(selection, session.draft);
  if (!intentResult.ok) {
    return {
      ok: false,
      message: intentResult.message,
      nextState: {
        editorDrafts: {
          ...state.editorDrafts,
          [state.activeEditorRef]: {
            ...session,
            validationError: intentResult.message,
          },
        },
      },
    };
  }

  const result = applyGraphIntentToPrompt(state.canonicalPrompt, { nodes: state.nodes, edges: state.edges }, intentResult.intent);
  if (!result.supported) {
    const issues = result.issues.map((issue) => `${issue.nodeId ? `${issue.nodeId}: ` : ""}${issue.message}`);
    return {
      ok: false,
      message: issues[0] ?? "Failed to apply the active editor draft.",
      nextState: {
        syncIssues: issues,
      },
    };
  }

  clearPendingNodeExecutions();
  settleInterruptedExecutionRecords(state.canonicalPrompt.metadata.id);
  const hydrated = hydrateFromCanonicalPrompt(
    result.prompt,
    state.selectedNodeId,
    state.focusedBlockId,
    state.canvasLayout,
    state.mindMapNodePositions,
    state.collapsedBlockIds,
    state.hiddenBlockIds,
    state.hiddenDependencyPromptIds,
    omitDraftSession(state.editorDrafts, state.activeEditorRef),
    state.latestScopeOutputs,
    undefined,
    state.nodeRuntimeStates,
    state.graphProposals,
    state.nodeResultHistory,
    state.selectedProposalNodeId,
  );
  const isDirty = state.savedPromptDigest ? digestPrompt(result.prompt) !== state.savedPromptDigest : true;

  return {
    ok: true,
    nextState: {
      ...hydrated,
      nodeRuntimeStates: invalidateNodeRuntimeStates(hydrated.nodeRuntimeStates),
      nodeExecutionRecords: hydrated.nodeExecutionRecords,
      importError: null,
      syncIssues: [],
      isDirty,
      hasYamlDraftChanges: false,
      executionStatus: "idle" as StudioRuntimeExecutionStatus,
      runtimeErrorSummary: null,
    },
  };
}

function emptyState() {
  const initialProfiles = createInitialNodeLlmProfiles();
  return {
    canonicalPrompt: null as Prompt | null,
    savedPrompt: null as Prompt | null,
    savedPromptDigest: null as string | null,
    sourceLabel: "No prompt loaded",
    currentProjectId: null as string | null,
    currentProjectName: null as string | null,
    paletteFocusKind: null as StudioNodeKind | null,
    focusedBlockId: null as string | null,
    canvasLayout: "mind_map" as CanvasLayout,
    mindMapNodePositions: {} as Record<string, CanvasNodePosition>,
    collapsedBlockIds: [] as string[],
    hiddenBlockIds: [] as string[],
    hiddenDependencyPromptIds: [] as string[],
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
    selectedProposalNodeId: null as string | null,
    activeEditorRef: null as string | null,
    editorDrafts: {} as Record<string, EditorDraftSession>,
    runtimePreview: emptyRuntimePreview(),
    ...createEmptyScopeRuntimeState(),
    nodeLlmProfiles: initialProfiles.profiles,
    nodeLlmProfileOrder: initialProfiles.order,
    nodeLlmSettings: getInitialStudioNodeLlmSettings(),
    nodeLlmProbe: emptyNodeLlmProbeState(),
    nodeLlmModelCatalog: emptyNodeLlmModelCatalogState(),
    messageSuggestion: emptyMessageSuggestionState(),
    consoleEvents: [] as StudioConsoleEvent[],
    nodeModelAssignments: {} as StudioNodeModelAssignments,
    nodeModelStrategies: {} as StudioNodeModelStrategies,
    graphProposals: {} as StudioGraphProposals,
    nodeResultHistory: {} as StudioNodeResultHistory,
    nodeRuntimeStates: {} as Record<string, NodeRuntimeState>,
    nodeExecutionRecords: {} as Record<string, NodeExecutionRecord>,
  };
}

function hydrateFromCanonicalPrompt(
  prompt: Prompt,
  selectedNodeId: string | null,
  focusedBlockId: string | null,
  canvasLayout: CanvasLayout,
  mindMapNodePositions: Record<string, CanvasNodePosition>,
  collapsedBlockIds: string[],
  hiddenBlockIds: string[],
  hiddenDependencyPromptIds: string[],
  editorDrafts: Record<string, EditorDraftSession>,
  latestScopeOutputs: Record<string, StudioPromptUnitOutput>,
  runtimePreview?: StudioRuntimePreview,
  previousNodeRuntimeStates: Record<string, NodeRuntimeState> = {},
  graphProposals: StudioGraphProposals = {},
  nodeResultHistory: StudioNodeResultHistory = {},
  selectedProposalNodeId: string | null = null,
): HydratedGraphState {
  const sanitizedHiddenBlockIds = sanitizeHiddenBlockIdsForPrompt(prompt, hiddenBlockIds);
  const sanitizedHiddenDependencyPromptIds = sanitizeHiddenDependencyPromptIdsForPrompt(prompt, hiddenDependencyPromptIds);
  const graph = projectPromptToCanvas(prompt, {
    layout: canvasLayout,
    collapsedBlockIds,
    hiddenBlockIds: sanitizedHiddenBlockIds,
    hiddenDependencyPromptIds: sanitizedHiddenDependencyPromptIds,
    positionOverrides: canvasLayout === "mind_map" ? mindMapNodePositions : undefined,
  });
  const sanitizedProposals = sanitizeGraphProposalsForGraph(
    graphProposals,
    new Set(graph.nodes.map((node) => node.id)),
  );
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
    hiddenBlockIds: sanitizedHiddenBlockIds,
    hiddenDependencyPromptIds: sanitizedHiddenDependencyPromptIds,
    latestScopeOutputs,
  });

  return {
    canonicalPrompt: prompt,
    yamlText: serializePrompt(prompt),
    nodes: graph.nodes,
    edges: graph.edges,
    selectedNodeId: nextSelectedNodeId,
    selectedProposalNodeId:
      selectedProposalNodeId &&
      Object.values(sanitizedProposals).some(
        (proposal) => proposal.status === "preview" && proposalContainsNodeId(proposal.blocks, selectedProposalNodeId),
      )
        ? selectedProposalNodeId
        : null,
    activeEditorRef: editorState.activeEditorRef,
    editorDrafts: editorState.editorDrafts,
    focusedBlockId,
    mindMapNodePositions,
    hiddenBlockIds: sanitizedHiddenBlockIds,
    hiddenDependencyPromptIds: sanitizedHiddenDependencyPromptIds,
    runtimePreview: runtimePreview ?? createRuntimePreviewFromPrompt(prompt, "resolve"),
    selectedScopePromptPreview: scopeRuntimeState.selectedScopePromptPreview,
    latestScopeOutputs: scopeRuntimeState.latestScopeOutputs,
    graphProposals: sanitizedProposals,
    nodeResultHistory,
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

function buildPopulatedState(
  prompt: Prompt,
  sourceLabel: string,
  projectContext: { projectId?: string | null; projectName?: string | null } | undefined,
  selectedNodeId: string | null,
  runtimePreview?: StudioRuntimePreview,
  nodeLlmProfiles: Record<string, StudioNodeLlmProfile> = {},
  nodeLlmProfileOrder: string[] = [],
  nodeLlmSettings: StudioNodeLlmSettings = getInitialStudioNodeLlmSettings(),
  nodeLlmProbe: StudioNodeLlmProbeState = emptyNodeLlmProbeState(),
  nodeLlmModelCatalog: StudioNodeLlmModelCatalogState = emptyNodeLlmModelCatalogState(),
  nodeModelAssignments: StudioNodeModelAssignments = {},
  nodeModelStrategies: StudioNodeModelStrategies = {},
  graphProposals: StudioGraphProposals = {},
  nodeResultHistory: StudioNodeResultHistory = {},
  messageSuggestion: StudioMessageSuggestionState = emptyMessageSuggestionState(),
  consoleEvents: StudioConsoleEvent[] = [],
) {
  const persistedRuntime = resolvePersistedStudioPromptRuntime(prompt);
  const sanitizedAssignments = ensureDefaultNodeModelAssignments({
    prompt,
    assignments: sanitizeNodeModelAssignments(nodeModelAssignments, new Set(nodeLlmProfileOrder)),
    profiles: nodeLlmProfiles,
    profileOrder: nodeLlmProfileOrder,
  });
  const hydrated = hydrateFromCanonicalPrompt(
    prompt,
    selectedNodeId,
    null,
    "mind_map",
    {},
    [],
    [],
    [],
    {},
    persistedRuntime?.latestScopeOutputs ?? {},
    runtimePreview,
    persistedRuntime?.nodeRuntimeStates ?? {},
    Object.keys(graphProposals).length > 0 ? graphProposals : persistedRuntime?.graphProposals ?? {},
    Object.keys(nodeResultHistory).length > 0 ? nodeResultHistory : persistedRuntime?.nodeResultHistory ?? {},
  );
  const savedPrompt = clonePrompt(prompt);
  const savedPromptDigest = digestPrompt(savedPrompt);

  return {
    ...hydrated,
    savedPrompt,
    savedPromptDigest,
    sourceLabel,
    currentProjectId: projectContext?.projectId ?? null,
    currentProjectName: projectContext?.projectName ?? null,
    paletteFocusKind: null as StudioNodeKind | null,
    canvasLayout: "mind_map" as CanvasLayout,
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
    nodeLlmProfiles,
    nodeLlmProfileOrder,
    nodeLlmSettings,
    nodeLlmProbe,
    nodeLlmModelCatalog,
    messageSuggestion,
    consoleEvents,
    nodeModelAssignments: sanitizedAssignments,
    nodeModelStrategies,
    graphProposals: hydrated.graphProposals,
    nodeResultHistory: hydrated.nodeResultHistory,
  };
}

function startNodeExecution(input: {
  get: () => StudioState;
  set: (
    partial:
      | Partial<StudioState>
      | ((state: StudioState) => Partial<StudioState>),
  ) => void;
  nodeId: string;
  executionMode: StudioNodeExecutionMode;
}): void {
  const state = input.get();
  const prompt = state.canonicalPrompt;
  if (!prompt) {
    return;
  }

  const target = resolveRuntimeNodeTarget(state, input.nodeId);
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
  const promptSnapshot = createRuntimePromptSnapshot(
    clonePrompt(prompt),
    state.hiddenBlockIds,
    state.hiddenDependencyPromptIds,
    target.kind === "block" ? target.blockId : null,
  );
  const sourceSnapshotHash = digestPrompt(promptSnapshot);
  const targetSnapshot = target.kind === "prompt" ? target : { ...target };
  const upstreamOutputs = listUpstreamNodeOutputs(promptSnapshot, targetSnapshot, state.nodeRuntimeStates);
  const effectiveProfileIds = resolveEffectiveNodeModelProfileIds({
    prompt: promptSnapshot,
    target: targetSnapshot,
    nodeModelAssignments: state.nodeModelAssignments,
  });
  const effectiveStrategy = resolveEffectiveNodeModelStrategy({
    prompt: promptSnapshot,
    target: targetSnapshot,
    nodeModelStrategies: state.nodeModelStrategies,
  });
  const effectiveProfiles = effectiveProfileIds
    .map((profileId) => state.nodeLlmProfiles[profileId])
    .filter((profile): profile is StudioNodeLlmProfile => Boolean(profile));
  const executionRecord = createNodeExecutionRecord({
    executionId,
    promptId: promptSnapshot.metadata.id,
    nodeId: target.runtimeNodeId,
    scope: targetSnapshot.scope,
    mode: input.executionMode === "graph_proposal" ? "structure" : "text",
    sourceSnapshotHash,
    startedAt,
  });

  if (effectiveProfiles.length === 0) {
    const errorMessage =
      "No models are assigned to this node. Add model profiles in the global Models panel and assign them on the root or current node.";
    const failedRecord = completeNodeExecutionRecord(executionRecord, { status: "error", errorMessage }, startedAt);
    nodeExecutionRepository.put(failedRecord);

    input.set({
      nodeRuntimeStates: {
        ...state.nodeRuntimeStates,
        [target.runtimeNodeId]: completeRuntimeState(currentRuntimeState, executionId, startedAt, "error", errorMessage),
      },
      nodeExecutionRecords: {
        ...state.nodeExecutionRecords,
        [executionId]: failedRecord,
      },
    });
    return;
  }

  const controller = new AbortController();
  const handle: ActiveNodeExecutionHandle = {
    executionId,
    controller,
    timerId: null,
    started: false,
  };

  activeNodeExecutionHandles.set(target.runtimeNodeId, handle);
  nodeExecutionRepository.put(executionRecord);

  input.set({
    nodeRuntimeStates: {
      ...state.nodeRuntimeStates,
      [target.runtimeNodeId]: startRuntimeState(currentRuntimeState, executionId, startedAt, sourceSnapshotHash),
    },
    nodeExecutionRecords: {
      ...state.nodeExecutionRecords,
      [executionId]: executionRecord,
    },
    consoleEvents: appendConsoleEvent(
      state.consoleEvents,
      createConsoleEvent({
        status: "info",
        category: input.executionMode === "graph_proposal" ? "structure" : "text",
        message: `${input.executionMode === "graph_proposal" ? "Queued structure generation" : "Queued text generation"} for ${targetSnapshot.scope.mode === "root" ? promptSnapshot.metadata.title ?? promptSnapshot.metadata.id : target.runtimeNodeId}.`,
        scopeRef: targetSnapshot.scope.mode === "root" ? `root:${promptSnapshot.metadata.id}` : `block:${target.runtimeNodeId}`,
        nodeId: target.runtimeNodeId,
      }),
    ),
  });

  let streamingPreviewLogged = false;
  const syncRemoteExecutionProgress = (record: NodeExecutionRecord) => {
    input.set((current) => {
      const runtimeState = current.nodeRuntimeStates[target.runtimeNodeId];
      if (!runtimeState || runtimeState.activeExecutionId !== executionId) {
        return {};
      }

      const nextRuntimeState =
        record.status === "running" || record.status === "cancel_requested"
          ? {
              ...runtimeState,
              ...(typeof record.output === "string" ? { output: record.output } : {}),
              ...(record.cancelRequestedAt ? { cancelRequestedAt: record.cancelRequestedAt } : {}),
            }
          : runtimeState;

      const nextConsoleEvents =
        input.executionMode === "graph_proposal" &&
        !streamingPreviewLogged &&
        record.status === "running" &&
        typeof record.output === "string" &&
        record.output.trim().length > 0
          ? appendConsoleEvent(
              current.consoleEvents,
              createConsoleEvent({
                status: "info",
                category: "structure",
                message: `Streaming structure response for ${targetSnapshot.scope.mode === "root" ? promptSnapshot.metadata.title ?? promptSnapshot.metadata.id : target.runtimeNodeId}...`,
                scopeRef: targetSnapshot.scope.mode === "root" ? `root:${promptSnapshot.metadata.id}` : `block:${target.runtimeNodeId}`,
                nodeId: target.runtimeNodeId,
              }),
            )
          : current.consoleEvents;

      if (nextConsoleEvents !== current.consoleEvents) {
        streamingPreviewLogged = true;
      }

      return {
        nodeRuntimeStates: {
          ...current.nodeRuntimeStates,
          [target.runtimeNodeId]: nextRuntimeState,
        },
        nodeExecutionRecords: {
          ...current.nodeExecutionRecords,
          [executionId]: record,
        },
        ...(nextConsoleEvents !== current.consoleEvents ? { consoleEvents: nextConsoleEvents } : {}),
      };
    });
  };

  const timerId = setTimeout(() => {
    const activeHandle = activeNodeExecutionHandles.get(target.runtimeNodeId);
    if (!activeHandle || activeHandle.executionId !== executionId) {
      return;
    }

    activeHandle.timerId = null;
    activeHandle.started = true;

    void (async () => {
      try {
        const renderedPromptPreview = createRenderedPromptPreview(promptSnapshot, targetSnapshot.scope, sourceSnapshotHash);

        if (input.executionMode === "graph_proposal") {
          const proposalProfile =
            (effectiveStrategy.mergeProfileId
              ? effectiveProfiles.find((profile) => profile.id === effectiveStrategy.mergeProfileId)
              : undefined) ?? effectiveProfiles[0];
          if (!proposalProfile) {
            throw new Error("Graph proposal generation requires at least one model profile.");
          }

          const llmClient = resolveStudioNodeLlmClient(proposalProfile.settings);
          if (!llmClient) {
            throw new Error(`Model profile "${proposalProfile.name}" is incomplete. Base URL and model are required.`);
          }

          const proposalPrompt = buildScopedLlmPrompt({
            prompt: promptSnapshot,
            scope: targetSnapshot.scope,
            upstreamOutputs,
          });
          input.set((current) => ({
            consoleEvents: appendConsoleEvent(
              current.consoleEvents,
              createConsoleEvent({
                status: "info",
                category: "structure",
                message: `Requesting structure proposal from ${proposalProfile.name} for ${renderedPromptPreview.scope.label}.`,
                scopeRef: renderedPromptPreview.scope.scopeRef,
                nodeId: target.runtimeNodeId,
              }),
            ),
          }));
          const proposalMessages: LlmMessage[] = [
            ...proposalPrompt.messages,
            {
              role: "developer",
              content: buildGraphProposalInstruction({
                prompt: promptSnapshot,
                scope: renderedPromptPreview.scope,
              }),
            },
            {
              role: "user",
              content: buildGraphProposalUserPrompt({
                prompt: promptSnapshot,
                scope: renderedPromptPreview.scope,
                renderedPromptText: renderedPromptPreview.renderedText,
              }),
            },
          ];
          let proposalResult;
          let proposal;
          try {
            const typedProposal = await executeStudioTypedLlmWithRetries({
              kind: "structure",
              messages: proposalMessages,
              execute: (attempt, attemptMessages) =>
                executeStudioLlmWithRemoteFallback({
                  executionId: attempt === 0 ? executionId : `${executionId}__retry_${attempt}`,
                  promptId: promptSnapshot.metadata.id,
                  nodeId: target.runtimeNodeId,
                  scope: targetSnapshot.scope,
                  sourceSnapshotHash,
                  mode: "structure",
                  profile: proposalProfile,
                  messages: attemptMessages,
                  signal: controller.signal,
                  onRemoteRecord: (record) =>
                    syncRemoteExecutionProgress(
                      attempt === 0
                        ? record
                        : {
                            ...record,
                            executionId,
                          },
                    ),
                  localExecute: () =>
                    llmClient.generateText({
                      messages: attemptMessages,
                      signal: controller.signal,
                      stream: true,
                      onDelta(_deltaText, aggregateText) {
                        syncRemoteExecutionProgress({
                          ...executionRecord,
                          output: aggregateText,
                        });
                      },
                    }),
                }),
              parse: (result) =>
                createGraphProposalFromResponse({
                  prompt: promptSnapshot,
                  scope: renderedPromptPreview.scope,
                  sourceNodeId: input.nodeId,
                  sourceRuntimeNodeId: target.runtimeNodeId,
                  proposalId: createGraphProposalId(),
                  executionId,
                  responseText: result.outputText,
                }),
              onRetry: ({ attempt, errorMessage }) =>
                input.set((current) => ({
                  consoleEvents: appendConsoleEvent(
                    current.consoleEvents,
                    createConsoleEvent({
                      status: "info",
                      category: "structure",
                      message: `Structure response did not match the expected type. Retrying (${attempt}/2)... ${errorMessage}`,
                      scopeRef: renderedPromptPreview.scope.scopeRef,
                      nodeId: target.runtimeNodeId,
                    }),
                  ),
                })),
            });
            proposalResult = typedProposal.result;
            proposal = typedProposal.parsed;
          } catch (error) {
            if (error instanceof Error && error.message.startsWith("LLM response did not include generated text.")) {
              throw new Error(
                `Graph proposal generation returned an empty model response for ${renderedPromptPreview.scope.label}. Try adding a clearer root/block instruction or regenerate after refining the prompt. ${error.message}`,
              );
            }
            throw error;
          }

          if (controller.signal.aborted) {
            throw new Error("Execution aborted after proposal generation.");
          }

          input.set((current) => ({
            consoleEvents: appendConsoleEvent(
              current.consoleEvents,
              createConsoleEvent({
                status: "info",
                category: "structure",
                message: `Model responded for ${renderedPromptPreview.scope.label}. Parsing structure proposal...`,
                scopeRef: renderedPromptPreview.scope.scopeRef,
                nodeId: target.runtimeNodeId,
              }),
            ),
          }));

          const proposalId = proposal.proposalId;
          const latestOutput = createGraphProposalNodeOutput({
            prompt: promptSnapshot,
            scope: targetSnapshot.scope,
            sourceSnapshotHash,
            proposal,
            metadata: {
              executionId,
              provider: proposalResult.provider,
              model: proposalResult.model,
              executionTimeMs: proposalResult.executionTimeMs,
            },
          });
          const historyEntry = createNodeResultHistoryEntry({
            nodeId: target.runtimeNodeId,
            executionId,
            resultKind: "graph_proposal",
            output: latestOutput,
          });
          const completedRecord = completeNodeExecutionRecord(
            executionRecord,
            {
              status: "success",
              output: proposal.summary,
              provider: proposalResult.provider,
              model: proposalResult.model,
              ...(proposalResult.finishReason ? { finishReason: proposalResult.finishReason } : {}),
              executionTimeMs: proposalResult.executionTimeMs,
            },
            new Date(),
          );
          nodeExecutionRepository.put(completedRecord);

          input.set((current) => {
            const latestRuntimeState = current.nodeRuntimeStates[target.runtimeNodeId];
            if (!latestRuntimeState || latestRuntimeState.activeExecutionId !== executionId) {
              return {};
            }

            const nextProposals = Object.fromEntries(
              Object.entries(current.graphProposals).filter(
                ([, existingProposal]) =>
                  !(existingProposal.sourceRuntimeNodeId === target.runtimeNodeId && existingProposal.status === "preview"),
              ),
            );

            return {
              nodeRuntimeStates: {
                ...current.nodeRuntimeStates,
                [target.runtimeNodeId]: completeRuntimeState(
                  latestRuntimeState,
                  executionId,
                  new Date(),
                  "success",
                  proposal.summary,
                ),
              },
              nodeExecutionRecords: {
                ...current.nodeExecutionRecords,
                [executionId]: completedRecord,
              },
              latestScopeOutputs: {
                ...current.latestScopeOutputs,
                [latestOutput.scope.scopeRef]: latestOutput,
              },
              graphProposals: {
                ...nextProposals,
                [proposalId]: proposal,
              },
              consoleEvents: appendConsoleEvent(
                current.consoleEvents,
                createConsoleEvent({
                  status: "success",
                  category: "structure",
                  message:
                    proposal.warnings && proposal.warnings.length > 0
                      ? `Structure proposal ready for ${renderedPromptPreview.scope.label}: ${proposal.summary} (${proposal.warnings.length} warning${proposal.warnings.length === 1 ? "" : "s"})`
                      : `Structure proposal ready for ${renderedPromptPreview.scope.label}: ${proposal.summary}`,
                  scopeRef: renderedPromptPreview.scope.scopeRef,
                  nodeId: target.runtimeNodeId,
                }),
              ),
              nodeResultHistory: appendNodeResultHistoryEntry(current.nodeResultHistory, historyEntry),
              selectedScopePromptPreview:
                current.selectedScopePromptPreview?.scope.scopeRef === renderedPromptPreview.scope.scopeRef
                  ? renderedPromptPreview
                  : current.selectedScopePromptPreview,
              focusedBlockId: target.kind === "block" ? target.blockId : null,
              selectedProposalNodeId: proposal.blocks[0] ? `proposal:${proposal.blocks[0].proposalNodeId}` : current.selectedProposalNodeId,
              selectedNodeId:
                proposal.blocks[0] && current.selectedNodeId === input.nodeId ? null : current.selectedNodeId,
            };
          });

          return;
        }

        const llmPromptSource = targetSnapshot.scope.mode === "root" ? createAssembledRootPrompt(promptSnapshot) : promptSnapshot;
        const llmResults: Array<{
          profileId: string;
          profileName: string;
          provider: string;
          model: string;
          finishReason?: string;
          executionTimeMs: number;
          outputText: string;
          upstreamOutputCount: number;
        }> = [];

        input.set((current) => ({
          consoleEvents: appendConsoleEvent(
            current.consoleEvents,
            createConsoleEvent({
              status: "info",
              category: "text",
              message: `Requesting text generation from ${effectiveProfiles.length} model${effectiveProfiles.length === 1 ? "" : "s"} for ${renderedPromptPreview.scope.label}.`,
              scopeRef: renderedPromptPreview.scope.scopeRef,
              nodeId: target.runtimeNodeId,
            }),
          ),
        }));

        for (const profile of effectiveProfiles) {
          const profileExecutionId = `${executionId}__profile__${profile.id}`;
          const scopedPrompt = buildScopedLlmPrompt({
            prompt: llmPromptSource,
            scope: targetSnapshot.scope,
            upstreamOutputs,
          });
          const llmClient = resolveStudioNodeLlmClient(profile.settings);
          if (!llmClient) {
            throw new Error(`Model profile "${profile.name}" is incomplete. Base URL and model are required.`);
          }

          const typedTextResult = await executeStudioTypedLlmWithRetries({
            kind: "text",
            messages: scopedPrompt.messages,
            execute: (attempt, attemptMessages) =>
              executeStudioLlmWithRemoteFallback({
                executionId: attempt === 0 ? profileExecutionId : `${profileExecutionId}__retry_${attempt}`,
                promptId: promptSnapshot.metadata.id,
                nodeId: target.runtimeNodeId,
                scope: targetSnapshot.scope,
                sourceSnapshotHash,
                mode: "text",
                profile,
                messages: attemptMessages,
                signal: controller.signal,
                onRemoteRecord: syncRemoteExecutionProgress,
                localExecute: () =>
                  llmClient.generateText({
                    messages: attemptMessages,
                    signal: controller.signal,
                  }),
              }),
            parse: ensureTypedTextOutput,
            onRetry: ({ attempt, errorMessage }) =>
              input.set((current) => ({
                consoleEvents: appendConsoleEvent(
                  current.consoleEvents,
                  createConsoleEvent({
                    status: "info",
                    category: "text",
                    message: `Text response did not match the expected type. Retrying (${attempt}/2)... ${errorMessage}`,
                    scopeRef: renderedPromptPreview.scope.scopeRef,
                    nodeId: target.runtimeNodeId,
                  }),
                ),
              })),
          });
          const llmResult = typedTextResult.result;
          llmResults.push({
            profileId: profile.id,
            profileName: profile.name,
            provider: llmResult.provider,
            model: llmResult.model,
            ...(llmResult.finishReason ? { finishReason: llmResult.finishReason } : {}),
            executionTimeMs: llmResult.executionTimeMs,
            outputText: llmResult.outputText,
            upstreamOutputCount: scopedPrompt.upstreamOutputCount,
          });
        }
        if (controller.signal.aborted) {
          throw new Error("Execution aborted after runtime resolution.");
        }

        const executedAt = new Date();
        const variants = llmResults.map((result) => ({
          profileId: result.profileId,
          profileName: result.profileName,
          provider: result.provider,
          model: result.model,
          executionTimeMs: result.executionTimeMs,
          outputText: result.outputText,
        }));
        let finalOutput: string | undefined;
        let finalProvider = llmResults.length === 1 ? llmResults[0]?.provider : "multiple";
        let finalModel = llmResults.length === 1 ? llmResults[0]?.model : `${llmResults.length} models`;
        let finalFinishReason = llmResults.length === 1 ? llmResults[0]?.finishReason : undefined;
        let aggregateExecutionTimeMs = llmResults.reduce((total, item) => total + item.executionTimeMs, 0);
        let mergeProfileId: string | undefined;

        if (llmResults.length <= 1) {
          finalOutput = llmResults[0]?.outputText;
        } else if (effectiveStrategy.mode === "merge") {
          const mergeProfile =
            (effectiveStrategy.mergeProfileId
              ? effectiveProfiles.find((profile) => profile.id === effectiveStrategy.mergeProfileId)
              : undefined) ?? effectiveProfiles[0];
          if (!mergeProfile) {
            throw new Error("Merge mode requires at least one available model profile.");
          }

          const mergeClient = resolveStudioNodeLlmClient(mergeProfile.settings);
          if (!mergeClient) {
            throw new Error(`Merge profile "${mergeProfile.name}" is incomplete.`);
          }

          const mergePrompt = buildScopedLlmPrompt({
            prompt: llmPromptSource,
            scope: targetSnapshot.scope,
            upstreamOutputs: createMergedCandidateSummary(llmResults),
          });
          const mergeMessages: LlmMessage[] = [
            ...mergePrompt.messages,
            {
              role: "developer",
              content:
                "Merge the candidate outputs above into one final answer. Keep the strongest parts, remove contradictions, and return only the merged result.",
            },
          ];
          const typedMergeResult = await executeStudioTypedLlmWithRetries({
            kind: "text",
            messages: mergeMessages,
            execute: (attempt, attemptMessages) =>
              executeStudioLlmWithRemoteFallback({
                executionId:
                  attempt === 0
                    ? `${executionId}__merge__${mergeProfile.id}`
                    : `${executionId}__merge__${mergeProfile.id}__retry_${attempt}`,
                promptId: promptSnapshot.metadata.id,
                nodeId: target.runtimeNodeId,
                scope: targetSnapshot.scope,
                sourceSnapshotHash,
                mode: "text",
                profile: mergeProfile,
                messages: attemptMessages,
                signal: controller.signal,
                localExecute: () =>
                  mergeClient.generateText({
                    messages: attemptMessages,
                    signal: controller.signal,
                  }),
              }),
            parse: ensureTypedTextOutput,
            onRetry: ({ attempt, errorMessage }) =>
              input.set((current) => ({
                consoleEvents: appendConsoleEvent(
                  current.consoleEvents,
                  createConsoleEvent({
                    status: "info",
                    category: "text",
                    message: `Merged text response did not match the expected type. Retrying (${attempt}/2)... ${errorMessage}`,
                    scopeRef: renderedPromptPreview.scope.scopeRef,
                    nodeId: target.runtimeNodeId,
                  }),
                ),
              })),
          });
          const mergeResult = typedMergeResult.result;
          finalOutput = mergeResult.outputText;
          finalProvider = mergeResult.provider;
          finalModel = mergeResult.model;
          finalFinishReason = mergeResult.finishReason;
          aggregateExecutionTimeMs += mergeResult.executionTimeMs;
          mergeProfileId = mergeProfile.id;
        } else {
          const winnerProfileId = effectiveStrategy.selectedWinnerProfileId;
          const winner = winnerProfileId ? variants.find((variant) => variant.profileId === winnerProfileId) : undefined;
          finalOutput = winner?.outputText;
        }

        const latestOutputContent = finalOutput ?? buildMultiModelOutput(llmResults);
        const latestOutput = createGeneratedNodeOutput({
          prompt: promptSnapshot,
          scope: targetSnapshot.scope,
          sourceSnapshotHash,
          content: latestOutputContent,
          metadata: {
            executionId,
            provider: finalProvider,
            model: finalModel,
            executionTimeMs: aggregateExecutionTimeMs,
            upstreamOutputCount: llmResults[0]?.upstreamOutputCount ?? upstreamOutputs.length,
            profileIds: llmResults.map((item) => item.profileId),
            profileNames: llmResults.map((item) => item.profileName),
            providers: llmResults.map((item) => item.provider),
            models: llmResults.map((item) => item.model),
            executions: llmResults,
            variants,
            executionMode: effectiveStrategy.mode,
            ...(mergeProfileId ? { mergeProfileId } : {}),
            ...(effectiveStrategy.selectedWinnerProfileId ? { selectedWinnerProfileId: effectiveStrategy.selectedWinnerProfileId } : {}),
          },
        });
        const staleDescendantIds = listStaleDescendantNodeIds(promptSnapshot, targetSnapshot);
        const historyEntry = createNodeResultHistoryEntry({
          nodeId: target.runtimeNodeId,
          executionId,
          resultKind: "text_result",
          output: latestOutput,
        });

        input.set((current) => {
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
            "success",
            finalOutput,
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

          const completedRecord = completeNodeExecutionRecord(
            latestExecutionRecord,
            {
              status: "success",
              output: latestOutputContent,
              provider: finalProvider,
              model: finalModel,
              ...(finalFinishReason ? { finishReason: finalFinishReason } : {}),
              executionTimeMs: aggregateExecutionTimeMs,
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
            consoleEvents: appendConsoleEvent(
              current.consoleEvents,
              createConsoleEvent({
                status: "success",
                category: "text",
                message: `Text generation completed for ${renderedPromptPreview.scope.label}.`,
                scopeRef: renderedPromptPreview.scope.scopeRef,
                nodeId: target.runtimeNodeId,
              }),
            ),
            latestScopeOutputs: {
              ...current.latestScopeOutputs,
              [latestOutput.scope.scopeRef]: latestOutput,
            },
            nodeResultHistory: appendNodeResultHistoryEntry(current.nodeResultHistory, historyEntry),
            selectedScopePromptPreview:
              current.selectedScopePromptPreview?.scope.scopeRef === renderedPromptPreview.scope.scopeRef
                ? renderedPromptPreview
                : current.selectedScopePromptPreview,
          };
        });
      } catch (error) {
        const activeState = input.get();
        const latestRuntimeState = activeState.nodeRuntimeStates[target.runtimeNodeId];
        const latestExecutionRecord = nodeExecutionRepository.get(executionId);
        if (!latestRuntimeState || latestRuntimeState.activeExecutionId !== executionId || !latestExecutionRecord) {
          return;
        }

        const cancelledAt = new Date();
        const isAbort = controller.signal.aborted;
        input.set((current) => {
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
            consoleEvents: appendConsoleEvent(
              current.consoleEvents,
              createConsoleEvent({
                status: isAbort ? "info" : "error",
                category: input.executionMode === "graph_proposal" ? "structure" : "text",
                message: isAbort
                  ? `Execution cancelled for ${targetSnapshot.scope.mode === "root" ? promptSnapshot.metadata.title ?? promptSnapshot.metadata.id : target.runtimeNodeId}.`
                  : `Execution failed for ${targetSnapshot.scope.mode === "root" ? promptSnapshot.metadata.title ?? promptSnapshot.metadata.id : target.runtimeNodeId}: ${errorMessage}`,
                scopeRef: targetSnapshot.scope.mode === "root" ? `root:${promptSnapshot.metadata.id}` : `block:${target.runtimeNodeId}`,
                nodeId: target.runtimeNodeId,
              }),
            ),
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
      return buildPopulatedState(
        parsed.prompt,
        sourceLabel,
        {
          projectId: state.currentProjectId,
          projectName: state.currentProjectName,
        },
        state.selectedNodeId,
        parsed.runtimePreview,
        state.nodeLlmProfiles,
        state.nodeLlmProfileOrder,
        state.nodeLlmSettings,
        state.nodeLlmProbe,
        state.nodeLlmModelCatalog,
        sanitizeNodeModelAssignments(state.nodeModelAssignments, new Set(state.nodeLlmProfileOrder)),
        sanitizeNodeModelStrategies(state.nodeModelStrategies, new Set(state.nodeLlmProfileOrder)),
      );
    }),

  hydratePromptDocument: (prompt, sourceLabel = "studio://remote.prompt.json", projectContext) =>
    set((state) => {
      clearPendingNodeExecutions();
      if (state.canonicalPrompt) {
        settleInterruptedExecutionRecords(state.canonicalPrompt.metadata.id);
      }
      return buildPopulatedState(
        prompt,
        sourceLabel,
        projectContext,
        state.selectedNodeId,
        undefined,
        state.nodeLlmProfiles,
        state.nodeLlmProfileOrder,
        state.nodeLlmSettings,
        state.nodeLlmProbe,
        state.nodeLlmModelCatalog,
        sanitizeNodeModelAssignments(state.nodeModelAssignments, new Set(state.nodeLlmProfileOrder)),
        sanitizeNodeModelStrategies(state.nodeModelStrategies, new Set(state.nodeLlmProfileOrder)),
      );
    }),

  createStarterPrompt: (artifactType) =>
    set((state) => {
      clearPendingNodeExecutions();
      if (state.canonicalPrompt) {
        settleInterruptedExecutionRecords(state.canonicalPrompt.metadata.id);
      }
      const prompt = createStarterPrompt(artifactType);
      return buildPopulatedState(
        prompt,
        `starter://${artifactType}`,
        {
          projectId: state.currentProjectId,
          projectName: state.currentProjectName,
        },
        state.selectedNodeId,
        undefined,
        state.nodeLlmProfiles,
        state.nodeLlmProfileOrder,
        state.nodeLlmSettings,
        state.nodeLlmProbe,
        state.nodeLlmModelCatalog,
        sanitizeNodeModelAssignments(state.nodeModelAssignments, new Set(state.nodeLlmProfileOrder)),
        sanitizeNodeModelStrategies(state.nodeModelStrategies, new Set(state.nodeLlmProfileOrder)),
      );
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
    state.canvasLayout,
    state.mindMapNodePositions,
    state.collapsedBlockIds,
    state.hiddenBlockIds,
    state.hiddenDependencyPromptIds,
        {},
        {},
        undefined,
        state.nodeRuntimeStates,
        state.graphProposals,
        state.nodeResultHistory,
        state.selectedProposalNodeId,
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
    (() => {
      const state = get();
      if (!state.canonicalPrompt) {
        return;
      }
      const selectedBlockId = state.selectedNodeId?.startsWith("block:") ? state.selectedNodeId.replace("block:", "") : null;
      const runtimePrompt = createRuntimePromptSnapshot(
        state.canonicalPrompt,
        state.hiddenBlockIds,
        state.hiddenDependencyPromptIds,
        selectedBlockId,
      );

      set(
        syncSelectedScopeRuntimeState({
          canonicalPrompt: state.canonicalPrompt,
          selectedNodeId: state.selectedNodeId,
          hiddenBlockIds: state.hiddenBlockIds,
          hiddenDependencyPromptIds: state.hiddenDependencyPromptIds,
          latestScopeOutputs: state.latestScopeOutputs,
        }),
      );

      void (async () => {
        try {
          await warmPromptDependencyBundle(runtimePrompt);
        } catch {
          // Fall through to runtime preview refresh so missing or failed dependency fetches surface in preview issues.
        }

        set((current) => {
          if (!current.canonicalPrompt || current.canonicalPrompt.metadata.id !== state.canonicalPrompt?.metadata.id) {
            return {};
          }
          const scopeRuntimeState = syncSelectedScopeRuntimeState({
            canonicalPrompt: current.canonicalPrompt,
            selectedNodeId: current.selectedNodeId,
            hiddenBlockIds: current.hiddenBlockIds,
            hiddenDependencyPromptIds: current.hiddenDependencyPromptIds,
            latestScopeOutputs: current.latestScopeOutputs,
          });
          return scopeRuntimeState;
        });
      })();
    })(),

  runRuntimeAction: (action) => {
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

    const runtimePrompt = createRuntimePromptSnapshot(
      prompt,
      state.hiddenBlockIds,
      state.hiddenDependencyPromptIds,
    );
    const result = executeRuntimeActionFromPrompt(runtimePrompt, action, { mode: "root" });
    const now = Date.now();
    const latestRootOutput = createPromptUnitOutput(runtimePrompt, { mode: "root" }, action, result.preview, digestPrompt(runtimePrompt));

    set((current) => ({
      runtimePreview: result.preview,
      runtimeRefreshedAt: now,
      executionStatus: result.success ? "success" : "failure",
      lastRuntimeAction: action,
      lastRuntimeScope: { mode: "root" } as StudioRuntimeExecutionScope,
      lastRuntimeAt: now,
      runtimeErrorSummary: result.errorSummary ?? null,
      latestScopeOutputs: {
        ...current.latestScopeOutputs,
        [latestRootOutput.scope.scopeRef]: latestRootOutput,
      },
    }));
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

    const runtimePrompt = createRuntimePromptSnapshot(
      prompt,
      state.hiddenBlockIds,
      state.hiddenDependencyPromptIds,
      blockId,
    );
    const result = executeRuntimeActionFromPrompt(runtimePrompt, action, { mode: "block", blockId });
    const now = Date.now();
    const latestBlockOutput = createPromptUnitOutput(
      runtimePrompt,
      { mode: "block", blockId },
      action,
      result.preview,
      digestPrompt(runtimePrompt),
    );

    set((current) => ({
      runtimePreview: result.preview,
      runtimeRefreshedAt: now,
      executionStatus: result.success ? "success" : "failure",
      lastRuntimeAction: action,
      lastRuntimeScope: { mode: "block", blockId } as StudioRuntimeExecutionScope,
      lastRuntimeAt: now,
      runtimeErrorSummary: result.errorSummary ?? null,
      latestScopeOutputs: {
        ...current.latestScopeOutputs,
        [latestBlockOutput.scope.scopeRef]: latestBlockOutput,
      },
    }));
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

    const selectedBlockId = state.selectedNodeId?.startsWith("block:") ? state.selectedNodeId.replace("block:", "") : null;
    const runtimePrompt = createRuntimePromptSnapshot(
      prompt,
      state.hiddenBlockIds,
      state.hiddenDependencyPromptIds,
      selectedBlockId,
    );
    const scope = resolveSelectedStudioScope(runtimePrompt, state.selectedNodeId);
    const result = executeRuntimeActionFromPrompt(runtimePrompt, action, scope);
    const now = Date.now();
    const latestOutput = createPromptUnitOutput(runtimePrompt, scope, action, result.preview, digestPrompt(runtimePrompt));

    set((current) => ({
      runtimePreview: result.preview,
      runtimeRefreshedAt: now,
      executionStatus: result.success ? "success" : "failure",
      lastRuntimeAction: action,
      lastRuntimeScope: scope,
      lastRuntimeAt: now,
      runtimeErrorSummary: result.errorSummary ?? null,
      latestScopeOutputs: {
        ...current.latestScopeOutputs,
        [latestOutput.scope.scopeRef]: latestOutput,
      },
    }));
  },

  applyNodeLlmPreset: (presetId) =>
    set((state) => {
      const nextSettings = getStudioNodeLlmPresetSettings(presetId, state.nodeLlmSettings);
      writePersistedStudioNodeLlmSettings(nextSettings);
      return {
        nodeLlmSettings: nextSettings,
        nodeLlmProbe: emptyNodeLlmProbeState(),
        nodeLlmModelCatalog: emptyNodeLlmModelCatalogState(),
      };
    }),

  saveNodeLlmProfile: ({ profileId, name }) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return null;
    }

    const nextProfileId = profileId ?? createNodeLlmProfileId();
    set((state) => {
      const nextProfiles = {
        ...state.nodeLlmProfiles,
        [nextProfileId]: {
          id: nextProfileId,
          name: trimmedName,
          settings: normalizeStudioNodeLlmSettings(state.nodeLlmSettings),
        },
      };
      return {
        nodeLlmProfiles: nextProfiles,
        nodeLlmProfileOrder: state.nodeLlmProfileOrder.includes(nextProfileId)
          ? state.nodeLlmProfileOrder
          : [...state.nodeLlmProfileOrder, nextProfileId],
      };
    });
    return nextProfileId;
  },

  loadNodeLlmProfileIntoEditor: (profileId) =>
    set((state) => {
      const profile = state.nodeLlmProfiles[profileId];
      if (!profile) {
        return {};
      }
      writePersistedStudioNodeLlmSettings(profile.settings);
      return {
        nodeLlmSettings: profile.settings,
        nodeLlmProbe: emptyNodeLlmProbeState(),
        nodeLlmModelCatalog: emptyNodeLlmModelCatalogState(),
      };
    }),

  deleteNodeLlmProfile: (profileId) =>
    set((state) => {
      if (!state.nodeLlmProfiles[profileId]) {
        return {};
      }
      const nextProfiles = { ...state.nodeLlmProfiles };
      delete nextProfiles[profileId];
      const nextOrder = state.nodeLlmProfileOrder.filter((id) => id !== profileId);
      return {
        nodeLlmProfiles: nextProfiles,
        nodeLlmProfileOrder: nextOrder,
        nodeModelAssignments: sanitizeNodeModelAssignments(state.nodeModelAssignments, new Set(nextOrder)),
        nodeModelStrategies: sanitizeNodeModelStrategies(state.nodeModelStrategies, new Set(nextOrder)),
      };
    }),

  setNodeLlmSettings: (patch) =>
    set((state) => {
      const nextSettings = normalizeStudioNodeLlmSettings({
        ...state.nodeLlmSettings,
        ...patch,
      });
      writePersistedStudioNodeLlmSettings(nextSettings);
      return {
        nodeLlmSettings: nextSettings,
        nodeLlmProbe: emptyNodeLlmProbeState(),
        nodeLlmModelCatalog: emptyNodeLlmModelCatalogState(),
      };
    }),

  setNodeModelAssignments: (nodeId, profileIds) =>
    set((state) => {
      const sanitizedProfileIds = [...new Set(profileIds)].filter((profileId) => Boolean(state.nodeLlmProfiles[profileId]));
      return {
        nodeModelAssignments:
          sanitizedProfileIds.length > 0
            ? {
                ...state.nodeModelAssignments,
                [nodeId]: sanitizedProfileIds,
              }
            : Object.fromEntries(Object.entries(state.nodeModelAssignments).filter(([entryNodeId]) => entryNodeId !== nodeId)),
      };
    }),

  clearNodeModelAssignments: (nodeId) =>
    set((state) => ({
      nodeModelAssignments: Object.fromEntries(
        Object.entries(state.nodeModelAssignments).filter(([entryNodeId]) => entryNodeId !== nodeId),
      ),
    })),

  setNodeModelStrategy: (nodeId, patch) =>
    set((state) => {
      const mergedStrategy = {
        ...(state.nodeModelStrategies[nodeId] ?? { mode: "choose_best" as const }),
        ...patch,
      };
      const normalizedStrategy: StudioNodeModelStrategy = {
        mode: mergedStrategy.mode,
        ...(mergedStrategy.mergeProfileId ? { mergeProfileId: mergedStrategy.mergeProfileId } : {}),
        ...(mergedStrategy.selectedWinnerProfileId
          ? { selectedWinnerProfileId: mergedStrategy.selectedWinnerProfileId }
          : {}),
      };
      return {
        nodeModelStrategies: {
          ...state.nodeModelStrategies,
          [nodeId]: normalizedStrategy,
        },
      };
    }),

  clearNodeModelStrategy: (nodeId) =>
    set((state) => ({
      nodeModelStrategies: Object.fromEntries(
        Object.entries(state.nodeModelStrategies).filter(([entryNodeId]) => entryNodeId !== nodeId),
      ),
    })),

  selectNodeModelWinner: (nodeId, profileId) =>
    set((state) => {
      const runtimeState = state.nodeRuntimeStates[nodeId];
      const scopeRef = state.canonicalPrompt
        ? nodeId === getPromptRuntimeNodeId(state.canonicalPrompt)
          ? `root:${state.canonicalPrompt.metadata.id}`
          : `block:${nodeId}`
        : null;
      const scopeOutput = scopeRef ? state.latestScopeOutputs[scopeRef] : null;
      const variants = Array.isArray(scopeOutput?.metadata?.variants)
        ? (scopeOutput?.metadata?.variants as Array<{ profileId: string; outputText: string }>)
        : [];
      const winner = variants.find((variant) => variant.profileId === profileId);
      if (!runtimeState || !scopeRef || !scopeOutput || !winner) {
        return {};
      }

      return {
        nodeModelStrategies: {
          ...state.nodeModelStrategies,
          [nodeId]: {
            ...(state.nodeModelStrategies[nodeId] ?? { mode: "choose_best" as const }),
            selectedWinnerProfileId: profileId,
          },
        },
        nodeRuntimeStates: {
          ...state.nodeRuntimeStates,
          [nodeId]: {
            ...runtimeState,
            output: winner.outputText,
          },
        },
        latestScopeOutputs: {
          ...state.latestScopeOutputs,
          [scopeRef]: {
            ...scopeOutput,
            content: winner.outputText,
            metadata: {
              ...scopeOutput.metadata,
              selectedWinnerProfileId: profileId,
            },
          },
        },
      };
    }),

  generateNodeGraphProposal: (nodeId) => {
    let draftSyncFailed = false;
    set((state) => {
      const result = applyActiveEditorDraftState(state, { skipIfClean: true });
      draftSyncFailed = !result.ok;
      return result.nextState;
    });
    if (draftSyncFailed) {
      return;
    }

    startNodeExecution({
      get,
      set,
      nodeId,
      executionMode: "graph_proposal",
    });
  },

  applyGraphProposal: (proposalId) =>
    set((state) => {
      const proposal = state.graphProposals[proposalId];
      if (!proposal || !state.canonicalPrompt) {
        return {};
      }

      const applied = applyGraphProposalToPrompt({
        prompt: state.canonicalPrompt,
        focusedBlockId: state.focusedBlockId,
        proposal,
      });
      if (!applied.ok) {
        return {
          syncIssues: [applied.message],
        };
      }

      clearPendingNodeExecutions();
      settleInterruptedExecutionRecords(state.canonicalPrompt.metadata.id);
      const nextProposals: StudioGraphProposals = {
        ...state.graphProposals,
        [proposalId]: {
          ...proposal,
          status: "applied",
        },
      };
      const nextSelectedNodeId = proposal.sourceNodeId;
      const nextFocusedBlockId =
        proposal.scope.mode === "block" ? proposal.scope.blockId ?? state.focusedBlockId : state.focusedBlockId;
      const hydrated = hydrateFromCanonicalPrompt(
        applied.prompt,
        nextSelectedNodeId,
        nextFocusedBlockId,
        state.canvasLayout,
        state.mindMapNodePositions,
        state.collapsedBlockIds,
        state.hiddenBlockIds,
        state.hiddenDependencyPromptIds,
        state.editorDrafts,
        state.latestScopeOutputs,
        undefined,
        state.nodeRuntimeStates,
        nextProposals,
        state.nodeResultHistory,
        state.selectedProposalNodeId,
      );
      const isDirty = state.savedPromptDigest ? digestPrompt(applied.prompt) !== state.savedPromptDigest : true;

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
        selectedProposalNodeId: null,
      };
    }),

  rejectGraphProposal: (proposalId) =>
    set((state) => {
      const proposal = state.graphProposals[proposalId];
      if (!proposal) {
        return {};
      }

      return {
        graphProposals: {
          ...state.graphProposals,
          [proposalId]: {
            ...proposal,
            status: "rejected",
          },
        },
        selectedProposalNodeId:
          state.selectedProposalNodeId &&
          proposalContainsNodeId(proposal.blocks, state.selectedProposalNodeId)
            ? null
            : state.selectedProposalNodeId,
      };
    }),

  applyAllNodeGraphProposals: (sourceRuntimeNodeId) => {
    const proposals = Object.values(get().graphProposals)
      .filter((proposal) => proposal.sourceRuntimeNodeId === sourceRuntimeNodeId && proposal.status === "preview")
      .map((proposal) => proposal.proposalId);
    proposals.forEach((proposalId) => get().applyGraphProposal(proposalId));
  },

  rejectAllNodeGraphProposals: (sourceRuntimeNodeId) => {
    const proposals = Object.values(get().graphProposals)
      .filter((proposal) => proposal.sourceRuntimeNodeId === sourceRuntimeNodeId && proposal.status === "preview")
      .map((proposal) => proposal.proposalId);
    proposals.forEach((proposalId) => get().rejectGraphProposal(proposalId));
  },

  restoreNodeResultHistoryEntry: (nodeId, historyEntryId) =>
    set((state) => {
      const entry = state.nodeResultHistory[nodeId]?.find((candidate) => candidate.historyEntryId === historyEntryId);
      const prompt = state.canonicalPrompt;
      if (!entry || !prompt) {
        return {};
      }

      const scopeRef =
        nodeId === getPromptRuntimeNodeId(prompt) ? `root:${prompt.metadata.id}` : `block:${nodeId}`;
      const nextHistory = setActiveNodeResultHistoryEntry(state.nodeResultHistory, nodeId, historyEntryId);

      if (entry.resultKind === "graph_proposal") {
        const restoredProposal = entry.output.content as StudioGraphProposal;
        const nextProposalId = createGraphProposalId();
        const proposalCopy: StudioGraphProposal = {
          ...restoredProposal,
          proposalId: nextProposalId,
          executionId: entry.executionId,
          status: "preview",
          createdAt: Date.now(),
          blocks: cloneProposalBlocksWithPrefix(restoredProposal.blocks, nextProposalId),
        };

        return {
          nodeResultHistory: nextHistory,
          latestScopeOutputs: {
            ...state.latestScopeOutputs,
            [scopeRef]: {
              ...entry.output,
              content: proposalCopy,
              metadata: {
                ...entry.output.metadata,
                proposalId: proposalCopy.proposalId,
              },
            },
          },
          graphProposals: {
            ...state.graphProposals,
            [proposalCopy.proposalId]: proposalCopy,
          },
          selectedProposalNodeId: proposalCopy.blocks[0] ? `proposal:${proposalCopy.blocks[0].proposalNodeId}` : state.selectedProposalNodeId,
          selectedNodeId: null,
        };
      }

      const runtimeState = state.nodeRuntimeStates[nodeId];
      return {
        nodeResultHistory: nextHistory,
        latestScopeOutputs: {
          ...state.latestScopeOutputs,
          [scopeRef]: entry.output,
        },
        nodeRuntimeStates: runtimeState
          ? {
              ...state.nodeRuntimeStates,
              [nodeId]: {
                ...runtimeState,
                output: typeof entry.output.content === "string" ? entry.output.content : runtimeState.output,
              },
            }
          : state.nodeRuntimeStates,
      };
    }),

  selectNodeLlmModel: (model) =>
    set((state) => {
      const nextSettings = normalizeStudioNodeLlmSettings({
        ...state.nodeLlmSettings,
        model,
      });
      writePersistedStudioNodeLlmSettings(nextSettings);
      return {
        nodeLlmSettings: nextSettings,
        nodeLlmProbe: emptyNodeLlmProbeState(),
      };
    }),

  resetNodeLlmSettings: () =>
    set(() => {
      clearPersistedStudioNodeLlmSettings();
      return {
        nodeLlmSettings: getInitialStudioNodeLlmSettings(),
        nodeLlmProbe: emptyNodeLlmProbeState(),
        nodeLlmModelCatalog: emptyNodeLlmModelCatalogState(),
      };
    }),

  refreshNodeLlmModels: async () => {
    const settings = get().nodeLlmSettings;
    if (!settings.baseUrl) {
      set({
        nodeLlmModelCatalog: {
          status: "failure",
          message: "Base URL is required before loading models.",
          models: [],
          source: null,
          refreshedAt: Date.now(),
        },
      });
      return;
    }

    set((state) => ({
      nodeLlmModelCatalog: {
        ...state.nodeLlmModelCatalog,
        status: "loading",
        message: "Loading models...",
      },
    }));

    try {
      const result = await discoverStudioNodeLlmModels(settings);
      set((state) => {
        const hasCurrentModel = result.models.includes(state.nodeLlmSettings.model);
        const nextModel = state.nodeLlmSettings.model || result.models[0] || "";
        const nextSettings = hasCurrentModel || !nextModel
          ? state.nodeLlmSettings
          : normalizeStudioNodeLlmSettings({
              ...state.nodeLlmSettings,
              model: nextModel,
            });

        if (nextSettings !== state.nodeLlmSettings) {
          writePersistedStudioNodeLlmSettings(nextSettings);
        }

        return {
          nodeLlmSettings: nextSettings,
          nodeLlmModelCatalog: {
            status: "success",
            message: result.models.length > 0 ? `Loaded ${result.models.length} model(s).` : "No models returned.",
            models: result.models,
            source: result.source,
            refreshedAt: Date.now(),
          },
        };
      });
    } catch (error) {
      set({
        nodeLlmModelCatalog: {
          status: "failure",
          message: error instanceof Error ? error.message : String(error),
          models: [],
          source: null,
          refreshedAt: Date.now(),
        },
      });
    }
  },

  testNodeLlmConnection: async () => {
    const probeSequence = nextNodeLlmProbeSequence;
    nextNodeLlmProbeSequence += 1;
    const settings = get().nodeLlmSettings;
    const client = resolveStudioNodeLlmClient(settings);

    if (!client) {
      set({
        nodeLlmProbe: {
          status: "failure",
          message: "LLM config is incomplete. Base URL and model are required.",
          output: null,
          provider: null,
          model: null,
          executionTimeMs: null,
          testedAt: Date.now(),
        },
      });
      return;
    }

    set({
      nodeLlmProbe: {
        status: "testing",
        message: "Checking endpoint...",
        output: null,
        provider: null,
        model: null,
        executionTimeMs: null,
        testedAt: Date.now(),
      },
    });

    try {
      const result = await client.generateText({
        messages: [
          {
            role: "system",
            content: "Return a short readiness acknowledgement for PromptFarm node execution.",
          },
          {
            role: "user",
            content: "Reply in one short sentence confirming the model is reachable.",
          },
        ],
      });

      if (probeSequence !== nextNodeLlmProbeSequence - 1) {
        return;
      }

      set({
        nodeLlmProbe: {
          status: "success",
          message: "Endpoint responded successfully.",
          output: result.outputText,
          provider: result.provider,
          model: result.model,
          executionTimeMs: result.executionTimeMs,
          testedAt: Date.now(),
        },
      });
    } catch (error) {
      if (probeSequence !== nextNodeLlmProbeSequence - 1) {
        return;
      }

      set({
        nodeLlmProbe: {
          status: "failure",
          message: error instanceof Error ? error.message : String(error),
          output: null,
          provider: null,
          model: null,
          executionTimeMs: null,
          testedAt: Date.now(),
        },
      });
    }
  },

  testNodeLlmConnectionAndRunSelectedNode: async () => {
    await get().testNodeLlmConnection();
    const state = get();
    if (state.nodeLlmProbe.status !== "success" || !state.selectedNodeId) {
      return;
    }

    const selectedNode = state.nodes.find((node) => node.id === state.selectedNodeId);
    if (!selectedNode || (selectedNode.data.kind !== "prompt" && selectedNode.data.kind !== "block")) {
      return;
    }

    state.runNode(state.selectedNodeId);
  },

  suggestMessagesForActiveDraft: async () => {
    let draftSyncFailed = false;
    set((state) => {
      const result = applyActiveEditorDraftState(state, { skipIfClean: true });
      draftSyncFailed = !result.ok;
      if (!result.ok) {
        return {
          ...result.nextState,
          messageSuggestion: {
            ...emptyMessageSuggestionState(),
            status: "failure",
            message: `Fix the current draft before suggesting messages: ${result.message}`,
            generatedAt: Date.now(),
          },
        };
      }
      return result.nextState;
    });
    if (draftSyncFailed) {
      return;
    }

    const state = get();
    if (!state.canonicalPrompt || !state.activeEditorRef) {
      set({
        messageSuggestion: {
          ...emptyMessageSuggestionState(),
          status: "failure",
          message: "Select the root prompt or a block before suggesting messages.",
          generatedAt: Date.now(),
        },
      });
      return;
    }

    const selection = resolveEditorSelection({
      canonicalPrompt: state.canonicalPrompt,
      nodes: state.nodes,
      selectedNodeId: state.selectedNodeId,
      focusedBlockId: state.focusedBlockId,
    });
    if (!selection || selection.ref !== state.activeEditorRef) {
      set({
        messageSuggestion: {
          ...emptyMessageSuggestionState(),
          status: "failure",
          message: "Active editor session is out of sync with selection.",
          generatedAt: Date.now(),
        },
      });
      return;
    }

    const session = state.editorDrafts[state.activeEditorRef];
    if (!session) {
      set({
        messageSuggestion: {
          ...emptyMessageSuggestionState(),
          status: "failure",
          message: "No active editor draft.",
          generatedAt: Date.now(),
        },
      });
      return;
    }

    const suggestionInput = resolveMessageSuggestionInput(state.canonicalPrompt, selection, session.draft);
    if (!suggestionInput) {
      set({
        messageSuggestion: {
          ...emptyMessageSuggestionState(),
          status: "failure",
          message: "Message suggestion is only available for the root prompt and prompt blocks.",
          generatedAt: Date.now(),
        },
      });
      return;
    }

    if (!suggestionInput.promptSource.trim() && !suggestionInput.title.trim() && !suggestionInput.description.trim()) {
      set({
        messageSuggestion: {
          ...emptyMessageSuggestionState(),
          status: "failure",
          targetRef: suggestionInput.targetRef,
          inputSignature: suggestionInput.inputSignature,
          message: "Add prompt content, title, or description before suggesting prompt blocks.",
          generatedAt: Date.now(),
        },
      });
      return;
    }

    const llmSettings = resolveMessageSuggestionLlmSettings(state, suggestionInput.runtimeTarget);
    if (!llmSettings) {
      set({
        messageSuggestion: {
          ...emptyMessageSuggestionState(),
          status: "failure",
          targetRef: suggestionInput.targetRef,
          inputSignature: suggestionInput.inputSignature,
          message: "Configure a model profile on this node or set global model settings before suggesting messages.",
          generatedAt: Date.now(),
        },
      });
      return;
    }

    const llmClient = resolveStudioNodeLlmClient(llmSettings);
    if (!llmClient) {
      set({
        messageSuggestion: {
          ...emptyMessageSuggestionState(),
          status: "failure",
          targetRef: suggestionInput.targetRef,
          inputSignature: suggestionInput.inputSignature,
          message: "Selected model settings are incomplete. Base URL and model are required.",
          generatedAt: Date.now(),
        },
      });
      return;
    }

    const requestSequence = nextMessageSuggestionSequence;
    nextMessageSuggestionSequence += 1;

    set({
      messageSuggestion: {
        ...emptyMessageSuggestionState(),
        status: "generating",
        targetRef: suggestionInput.targetRef,
        inputSignature: suggestionInput.inputSignature,
        message: "Suggesting prompt blocks from the current draft...",
      },
    });

    try {
      const suggestionMessages: LlmMessage[] = [
        {
          role: "developer",
          content: buildMessageSuggestionInstruction({
            artifactType: suggestionInput.artifactType,
            entityKind: suggestionInput.entityKind,
            sourceMode: suggestionInput.sourceMode,
            ...(suggestionInput.blockKind ? { blockKind: suggestionInput.blockKind } : {}),
          }),
        },
        {
          role: "user",
          content: buildMessageSuggestionUserPrompt({
            artifactType: suggestionInput.artifactType,
            entityKind: suggestionInput.entityKind,
            title: suggestionInput.title,
            description: suggestionInput.description,
            promptSource: suggestionInput.promptSource,
            variableNames: suggestionInput.variableNames,
            ...(suggestionInput.blockKind ? { blockKind: suggestionInput.blockKind } : {}),
          }),
        },
      ];
      const typedSuggestion = await executeStudioTypedLlmWithRetries({
        kind: "messages",
        messages: suggestionMessages,
        execute: (_attempt, attemptMessages) =>
          llmClient.generateText({
            messages: attemptMessages,
          }),
        parse: (result) => parseMessageSuggestionResponse(result.outputText),
        onRetry: ({ attempt, errorMessage }) => {
          if (requestSequence !== nextMessageSuggestionSequence - 1) {
            return;
          }

          set((current) => ({
            messageSuggestion:
              current.messageSuggestion.targetRef === suggestionInput.targetRef
                ? {
                    ...current.messageSuggestion,
                    status: "generating",
                    message: `Previous response did not match the canonical message format. Retrying (${attempt}/2)... ${errorMessage}`,
                  }
                : current.messageSuggestion,
          }));
        },
      });
      const result = typedSuggestion.result;
      const parsed = typedSuggestion.parsed;

      if (requestSequence !== nextMessageSuggestionSequence - 1) {
        return;
      }

      set({
        messageSuggestion: {
          status: "success",
          targetRef: suggestionInput.targetRef,
          inputSignature: suggestionInput.inputSignature,
          summary: parsed.summary,
          suggestedMessages: parsed.messages,
          message: "Suggested messages are ready to review.",
          provider: result.provider,
          model: result.model,
          executionTimeMs: result.executionTimeMs,
          generatedAt: Date.now(),
        },
      });
    } catch (error) {
      if (requestSequence !== nextMessageSuggestionSequence - 1) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      set({
        messageSuggestion: {
          ...emptyMessageSuggestionState(),
          status: "failure",
          targetRef: suggestionInput.targetRef,
          inputSignature: suggestionInput.inputSignature,
          message,
          generatedAt: Date.now(),
        },
      });
    }
  },

  applyMessageSuggestionToActiveDraft: () =>
    set((state) => {
      if (!state.activeEditorRef) {
        return {};
      }
      const session = state.editorDrafts[state.activeEditorRef];
      if (!session || state.messageSuggestion.status !== "success" || state.messageSuggestion.targetRef !== state.activeEditorRef) {
        return {};
      }
      if (session.draft.entityKind !== "prompt" && session.draft.entityKind !== "block") {
        return {};
      }

      const nextDraft = {
        ...session.draft,
        messages: state.messageSuggestion.suggestedMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      };

      return {
        editorDrafts: {
          ...state.editorDrafts,
          [state.activeEditorRef]: {
            ...session,
            draft: nextDraft,
            dirty: getDraftHash(nextDraft) !== session.lastSyncedCanonicalHash,
            validationError: null,
          },
        },
      };
    }),

  clearMessageSuggestion: () =>
    set({
      messageSuggestion: emptyMessageSuggestionState(),
    }),

  recoverRemoteRuntimeForCurrentPrompt: async () => {
    const state = get();
    const prompt = state.canonicalPrompt;
    if (!prompt || !isStudioRemoteExecutionEnabled()) {
      return;
    }

    try {
      const authoritativePersisted = await readAuthoritativePersistedStudioPromptRuntime(prompt.metadata.id);
      if (authoritativePersisted) {
        const sanitized = sanitizePersistedStudioPromptRuntimeForPrompt(prompt, authoritativePersisted, {
          preserveActiveExecutions: true,
        });
        nodeExecutionRepository.pruneToPrompt(prompt.metadata.id, []);
        nodeExecutionRepository.putMany(Object.values(sanitized.nodeExecutionRecords));
        syncSequenceCountersFromPersistedRuntime(sanitized);

        set((current) => {
          if (!current.canonicalPrompt || current.canonicalPrompt.metadata.id !== prompt.metadata.id) {
            return {};
          }
          const hydrated = hydrateFromCanonicalPrompt(
            current.canonicalPrompt,
            current.selectedNodeId,
            current.focusedBlockId,
            current.canvasLayout,
            current.mindMapNodePositions,
            current.collapsedBlockIds,
            current.hiddenBlockIds,
            current.hiddenDependencyPromptIds,
            current.editorDrafts,
            sanitized.latestScopeOutputs,
            current.runtimePreview,
            sanitized.nodeRuntimeStates,
            sanitized.graphProposals,
            sanitized.nodeResultHistory,
            current.selectedProposalNodeId,
          );
          return {
            ...hydrated,
            nodeExecutionRecords: sanitized.nodeExecutionRecords,
          };
        });
      }
    } catch (error) {
      set((current) => ({
        consoleEvents: appendConsoleEvent(
          current.consoleEvents,
          createConsoleEvent({
            status: "error",
            category: "system",
            message: `Remote runtime recovery failed for ${prompt.metadata.title ?? prompt.metadata.id}: ${error instanceof Error ? error.message : String(error)}`,
            scopeRef: `root:${prompt.metadata.id}`,
            nodeId: getPromptRuntimeNodeId(prompt),
          }),
        ),
      }));
    }

    await recoverRemoteExecutionsForPrompt({
      get,
      set,
      promptId: prompt.metadata.id,
    });
    },

  clearWorkspace: () => {
    clearPendingNodeExecutions();
    activeRemoteExecutionRecoveryControllers.forEach((controller) => controller.abort());
    activeRemoteExecutionRecoveryControllers.clear();
    nodeExecutionRepository.clear();
    nextNodeExecutionSequence = 1;
    nextNodeLlmProbeSequence = 1;
    nextGraphProposalSequence = 1;
    nextNodeResultHistorySequence = 1;
    nextMessageSuggestionSequence = 1;
    nextConsoleEventSequence = 1;
    lastPersistedCanonicalPromptKey = null;
    set(emptyState());
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
        hiddenBlockIds: state.hiddenBlockIds,
        hiddenDependencyPromptIds: state.hiddenDependencyPromptIds,
        latestScopeOutputs: state.latestScopeOutputs,
      });
      return {
        selectedNodeId: id,
        selectedProposalNodeId: null,
        ...editorState,
        ...scopeRuntimeState,
      };
    }),

  setSelectedProposalNodeId: (id) =>
    set((state) => ({
      selectedProposalNodeId: id,
      selectedNodeId: id ? null : state.selectedNodeId,
      activeEditorRef: id ? null : state.activeEditorRef,
    })),

  clearSyncIssues: () =>
    set({
      syncIssues: [],
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
    set((state) => applyActiveEditorDraftState(state).nextState),

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
          hiddenBlockIds: state.hiddenBlockIds,
          hiddenDependencyPromptIds: state.hiddenDependencyPromptIds,
          latestScopeOutputs: state.latestScopeOutputs,
        });
        return {
          focusedBlockId: null,
          selectedNodeId,
          selectedProposalNodeId: null,
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
        hiddenBlockIds: state.hiddenBlockIds,
        hiddenDependencyPromptIds: state.hiddenDependencyPromptIds,
        latestScopeOutputs: state.latestScopeOutputs,
      });
      return {
        selectedNodeId,
        selectedProposalNodeId: null,
        ...editorState,
        ...scopeRuntimeState,
      };
    }),

  focusBlock: (blockId) =>
    set((state) => {
      if (!state.canonicalPrompt) return {};
      const graph = projectPromptToCanvas(state.canonicalPrompt, {
        layout: state.canvasLayout,
        collapsedBlockIds: state.collapsedBlockIds,
        hiddenBlockIds: state.hiddenBlockIds,
        hiddenDependencyPromptIds: state.hiddenDependencyPromptIds,
        positionOverrides: state.canvasLayout === "mind_map" ? state.mindMapNodePositions : undefined,
      });
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
        hiddenBlockIds: state.hiddenBlockIds,
        hiddenDependencyPromptIds: state.hiddenDependencyPromptIds,
        latestScopeOutputs: state.latestScopeOutputs,
      });
      return {
        focusedBlockId: blockId,
        nodes: graph.nodes,
        edges: graph.edges,
        selectedNodeId,
        selectedProposalNodeId: null,
        ...editorState,
        ...scopeRuntimeState,
      };
    }),

  setCanvasLayout: (layout) =>
    set((state) => {
      if (!state.canonicalPrompt || state.canvasLayout === layout) {
        return {};
      }
      const hydrated = hydrateFromCanonicalPrompt(
        state.canonicalPrompt,
        state.selectedNodeId,
        state.focusedBlockId,
        layout,
        state.mindMapNodePositions,
        state.collapsedBlockIds,
        state.hiddenBlockIds,
        state.hiddenDependencyPromptIds,
        state.editorDrafts,
        state.latestScopeOutputs,
        state.runtimePreview,
        state.nodeRuntimeStates,
        state.graphProposals,
        state.nodeResultHistory,
        state.selectedProposalNodeId,
      );
      return {
        ...hydrated,
        canvasLayout: layout,
      };
    }),

  toggleBlockCollapsed: (blockId) =>
    set((state) => {
      const collapsedBlockIds = state.collapsedBlockIds.includes(blockId)
        ? state.collapsedBlockIds.filter((id) => id !== blockId)
        : [...state.collapsedBlockIds, blockId];
      if (!state.canonicalPrompt) {
        return {
          collapsedBlockIds,
        };
      }
      const hydrated = hydrateFromCanonicalPrompt(
        state.canonicalPrompt,
        state.selectedNodeId,
        state.focusedBlockId,
        state.canvasLayout,
        state.mindMapNodePositions,
        collapsedBlockIds,
        state.hiddenBlockIds,
        state.hiddenDependencyPromptIds,
        state.editorDrafts,
        state.latestScopeOutputs,
        state.runtimePreview,
        state.nodeRuntimeStates,
        state.graphProposals,
        state.nodeResultHistory,
        state.selectedProposalNodeId,
      );
      return {
        ...hydrated,
        canvasLayout: state.canvasLayout,
        collapsedBlockIds,
      };
    }),

  toggleBlockHidden: (blockId) =>
    set((state) => {
      const hiddenBlockIds = state.hiddenBlockIds.includes(blockId)
        ? state.hiddenBlockIds.filter((id) => id !== blockId)
        : [...state.hiddenBlockIds, blockId];
      const hydrated = hydrateFromCanonicalPrompt(
        state.canonicalPrompt,
        state.selectedNodeId,
        state.focusedBlockId,
        state.canvasLayout,
        state.mindMapNodePositions,
        state.collapsedBlockIds,
        hiddenBlockIds,
        state.hiddenDependencyPromptIds,
        state.editorDrafts,
        state.latestScopeOutputs,
        state.runtimePreview,
        state.nodeRuntimeStates,
        state.graphProposals,
        state.nodeResultHistory,
        state.selectedProposalNodeId,
      );

      return {
        ...hydrated,
        canvasLayout: state.canvasLayout,
        collapsedBlockIds: state.collapsedBlockIds,
      };
    }),

  toggleDependencyHidden: (promptId) =>
    set((state) => {
      const hiddenDependencyPromptIds = state.hiddenDependencyPromptIds.includes(promptId)
        ? state.hiddenDependencyPromptIds.filter((id) => id !== promptId)
        : [...state.hiddenDependencyPromptIds, promptId];
      const hydrated = hydrateFromCanonicalPrompt(
        state.canonicalPrompt,
        state.selectedNodeId,
        state.focusedBlockId,
        state.canvasLayout,
        state.mindMapNodePositions,
        state.collapsedBlockIds,
        state.hiddenBlockIds,
        hiddenDependencyPromptIds,
        state.editorDrafts,
        state.latestScopeOutputs,
        state.runtimePreview,
        state.nodeRuntimeStates,
        state.graphProposals,
        state.nodeResultHistory,
        state.selectedProposalNodeId,
      );

      return {
        ...hydrated,
        canvasLayout: state.canvasLayout,
        collapsedBlockIds: state.collapsedBlockIds,
      };
    }),

  attachPromptDependency: (promptId) =>
    set((state) => {
      if (!state.canonicalPrompt || !promptId.trim() || state.canonicalPrompt.spec.use.some((dep) => dep.prompt === promptId)) {
        return {};
      }

      clearPendingNodeExecutions();
      settleInterruptedExecutionRecords(state.canonicalPrompt.metadata.id);

      const nextPrompt = clonePrompt(state.canonicalPrompt);
      nextPrompt.spec.use.push({
        prompt: promptId,
        mode: "inline",
      });

      const hydrated = hydrateFromCanonicalPrompt(
        nextPrompt,
        state.selectedNodeId,
        state.focusedBlockId,
        state.canvasLayout,
        state.mindMapNodePositions,
        state.collapsedBlockIds,
        state.hiddenBlockIds,
        state.hiddenDependencyPromptIds,
        state.editorDrafts,
        state.latestScopeOutputs,
        undefined,
        state.nodeRuntimeStates,
        state.graphProposals,
        state.nodeResultHistory,
        state.selectedProposalNodeId,
      );
      const isDirty = state.savedPromptDigest ? digestPrompt(nextPrompt) !== state.savedPromptDigest : true;

      void warmPromptDependencyBundle(nextPrompt)
        .then(() => {
          get().refreshSelectedScopePromptPreview();
        })
        .catch(() => {
          get().refreshSelectedScopePromptPreview();
        });

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

  detachPromptDependency: (promptId) =>
    set((state) => {
      if (!state.canonicalPrompt || !state.canonicalPrompt.spec.use.some((dep) => dep.prompt === promptId)) {
        return {};
      }

      clearPendingNodeExecutions();
      settleInterruptedExecutionRecords(state.canonicalPrompt.metadata.id);

      const nextPrompt = clonePrompt(state.canonicalPrompt);
      nextPrompt.spec.use = nextPrompt.spec.use.filter((dep) => dep.prompt !== promptId);

      const hydrated = hydrateFromCanonicalPrompt(
        nextPrompt,
        state.selectedNodeId,
        state.focusedBlockId,
        state.canvasLayout,
        state.mindMapNodePositions,
        state.collapsedBlockIds,
        state.hiddenBlockIds,
        state.hiddenDependencyPromptIds.filter((id) => id !== promptId),
        state.editorDrafts,
        state.latestScopeOutputs,
        undefined,
        state.nodeRuntimeStates,
        state.graphProposals,
        state.nodeResultHistory,
        state.selectedProposalNodeId,
      );
      const isDirty = state.savedPromptDigest ? digestPrompt(nextPrompt) !== state.savedPromptDigest : true;

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

  setPaletteFocusKind: (kind) => set({ paletteFocusKind: kind }),

  onNodesChange: (changes) =>
    set((state) => {
      const visualOnlyChanges = changes.filter(
        (change) => change.type === "position" || change.type === "dimensions" || change.type === "select",
      );
      const nextNodes = applyNodeChanges(visualOnlyChanges, state.nodes);
      if (state.canvasLayout !== "mind_map") {
        return {
          nodes: nextNodes,
        };
      }

      const movedNodeIds = new Set(
        changes.filter((change) => change.type === "position" && "position" in change && Boolean(change.position)).map((change) => change.id),
      );
      if (movedNodeIds.size === 0) {
        return {
          nodes: nextNodes,
        };
      }

      const nextMindMapNodePositions = { ...state.mindMapNodePositions };
      nextNodes.forEach((node) => {
        if (!movedNodeIds.has(node.id) || node.data.graphState === "proposal") {
          return;
        }
        nextMindMapNodePositions[node.id] = {
          x: node.position.x,
          y: node.position.y,
        };
      });

      return {
        nodes: nextNodes,
        mindMapNodePositions: nextMindMapNodePositions,
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
        state.canvasLayout,
        state.mindMapNodePositions,
        state.collapsedBlockIds,
        state.hiddenBlockIds,
        state.hiddenDependencyPromptIds,
        state.editorDrafts,
        state.latestScopeOutputs,
        undefined,
        state.nodeRuntimeStates,
        state.graphProposals,
        state.nodeResultHistory,
        state.selectedProposalNodeId,
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
    let draftSyncFailed = false;
    set((state) => {
      const result = applyActiveEditorDraftState(state, { skipIfClean: true });
      draftSyncFailed = !result.ok;
      return result.nextState;
    });
    if (draftSyncFailed) {
      return;
    }

    const syncedState = get();
    const target = resolveRuntimeNodeTarget(syncedState, nodeId);
    if (target) {
      const previewProposalCount = countPreviewGraphProposalsForRuntimeNode(syncedState.graphProposals, target.runtimeNodeId);
      if (previewProposalCount > 0) {
        const scopeRef =
          target.kind === "prompt" && syncedState.canonicalPrompt
            ? `root:${syncedState.canonicalPrompt.metadata.id}`
            : `block:${target.runtimeNodeId}`;
        const targetLabel =
          target.kind === "prompt"
            ? syncedState.canonicalPrompt?.metadata.title ?? syncedState.canonicalPrompt?.metadata.id ?? target.runtimeNodeId
            : target.runtimeNodeId;
        set((state) => ({
          consoleEvents: appendConsoleEvent(
            state.consoleEvents,
            createConsoleEvent({
              status: "info",
              category: "system",
              message: `Text generation for ${targetLabel} is starting while ${previewProposalCount} unapplied structure proposal${previewProposalCount === 1 ? "" : "s"} remain in preview. Apply or reject them first if you want generation to reflect the proposed graph.`,
              scopeRef,
              nodeId: target.runtimeNodeId,
            }),
          ),
        }));
      }
    }

    startNodeExecution({
      get,
      set,
      nodeId,
      executionMode: "text_result",
    });
  },

  stopNode: (nodeId) => {
    const state = get();
    const target = resolveRuntimeNodeTarget(state, nodeId);
    if (!target) {
      return;
    }

    const handle = activeNodeExecutionHandles.get(target.runtimeNodeId);
    const currentRuntimeState = state.nodeRuntimeStates[target.runtimeNodeId];
    if (!currentRuntimeState) {
      return;
    }
    const requestedAt = new Date();

    if (!handle || currentRuntimeState.activeExecutionId !== handle.executionId) {
      const activeExecutionId = currentRuntimeState.activeExecutionId;
      if (!activeExecutionId) {
        return;
      }

      const executionRecord = nodeExecutionRepository.get(activeExecutionId);
      if (!executionRecord || !isExecutionRecordActive(executionRecord)) {
        return;
      }

      const cancelRequestedRecord = requestNodeExecutionCancellation(executionRecord, requestedAt);
      nodeExecutionRepository.put(cancelRequestedRecord);
      set({
        nodeRuntimeStates: {
          ...state.nodeRuntimeStates,
          [target.runtimeNodeId]: markRuntimeStateCancelRequested(currentRuntimeState, requestedAt),
        },
        nodeExecutionRecords: {
          ...state.nodeExecutionRecords,
          [activeExecutionId]: cancelRequestedRecord,
        },
      });

      if (isStudioRemoteExecutionEnabled()) {
        void requestStudioRemoteExecutionCancellation(activeExecutionId)
          .then((remoteRecord) => {
            if (!remoteRecord) {
              return;
            }
            nodeExecutionRepository.put(remoteRecord);
            set((current) => {
              if (!current.canonicalPrompt) {
                return {};
              }
              return applyRecoveredExecutionRecordToState({
                state: current,
                prompt: current.canonicalPrompt,
                record: remoteRecord,
              });
            });
          })
          .catch(() => {
            // Keep the local cancel_requested state; recovery polling can settle it later.
          });
      }
      return;
    }

    const executionRecord = nodeExecutionRepository.get(handle.executionId);
    if (!executionRecord) {
      return;
    }

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

useStudioStore.subscribe((state) => {
  if (!state.canonicalPrompt) {
    return;
  }

  const bundle = {
    version: 1,
    promptId: state.canonicalPrompt.metadata.id,
    latestScopeOutputs: state.latestScopeOutputs,
    graphProposals: state.graphProposals,
    nodeResultHistory: state.nodeResultHistory,
    nodeRuntimeStates: state.nodeRuntimeStates,
    nodeExecutionRecords: state.nodeExecutionRecords,
  } satisfies PersistedStudioPromptRuntime;

  void writeAuthoritativePersistedStudioPromptRuntime(bundle).catch(() => {
    // Local cache remains available even if the authoritative backend is temporarily unavailable.
  });
});

let lastPersistedCanonicalPromptKey: string | null = null;

useStudioStore.subscribe((state) => {
  if (!state.canonicalPrompt) {
    lastPersistedCanonicalPromptKey = null;
    return;
  }

  const promptDigest = digestPrompt(state.canonicalPrompt);
  const persistenceKey = `${state.canonicalPrompt.metadata.id}:${promptDigest}`;
  if (persistenceKey === lastPersistedCanonicalPromptKey) {
    return;
  }

  lastPersistedCanonicalPromptKey = persistenceKey;
  void writeStudioPromptDocumentToRemote({
    prompt: state.canonicalPrompt,
    projectId: state.currentProjectId,
  }).catch(() => {
    // Runtime persistence remains available even if canonical prompt autosave is temporarily unavailable.
  });
});

export function resetStudioStoreForTests(yamlText?: string): void {
  clearPendingNodeExecutions();
  activeRemoteExecutionRecoveryControllers.forEach((controller) => controller.abort());
  activeRemoteExecutionRecoveryControllers.clear();
  nodeExecutionRepository.clear();
  nextNodeExecutionSequence = 1;
  nextNodeLlmProbeSequence = 1;
  nextNodeLlmProfileSequence = 1;
  nextGraphProposalSequence = 1;
  nextNodeResultHistorySequence = 1;
  nextMessageSuggestionSequence = 1;
  nextConsoleEventSequence = 1;
  if (!yamlText) {
    useStudioStore.setState(emptyState());
    return;
  }

  const parsed = parseYamlToCanonical(yamlText);
  if (!parsed.ok) {
    throw new Error(`Invalid test YAML: ${parsed.message}`);
  }

  const initialProfiles = createInitialNodeLlmProfiles();
  const next = buildPopulatedState(
    parsed.prompt,
    "studio://tests.prompt.yaml",
    undefined,
    null,
    parsed.runtimePreview,
    initialProfiles.profiles,
    initialProfiles.order,
    getInitialStudioNodeLlmSettings(),
  );
  useStudioStore.setState(next);
}

// Keep sample data available for targeted test setup.
export const STUDIO_SAMPLE_PROMPT_YAML = SAMPLE_PROMPT_YAML;
export { setStudioPersistenceAdapterForTests };
