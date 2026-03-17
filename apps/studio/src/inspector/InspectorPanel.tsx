import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { MessageTemplate, Prompt, PromptBlock } from "@promptfarm/core";
import { ArtifactType } from "@promptfarm/core";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { ScrollArea } from "../components/ui/scroll-area";
import { Separator } from "../components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import {
  resolveEditorSelection,
} from "./editorSession";
import { PromptBlockWorkspace } from "./PromptBlockWorkspace";
import { getBuildTargetHelperLabel, getBuildTargetOptionsForArtifact } from "../model/artifactBuildTargets";
import { getPromptBlockPath } from "../model/promptTree";
import type { StudioGraphProposalBlock } from "../graph/types";
import { createMessageSuggestionInputSignature } from "../runtime/messageSuggestion";
import { useStudioStore } from "../state/studioStore";

function Section({
  title,
  children,
  description,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-md border border-border/80 bg-muted/20 p-3">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">{title}</h3>
        {description ? <p className="mt-1 text-[11px] text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function PreviewValue({ value }: { value: unknown }) {
  if (typeof value === "string") {
    return <pre className="rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap text-foreground/90">{value}</pre>;
  }
  return (
    <pre className="rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed text-foreground/90">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function formatBlockKindLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function findProposalBlock(blocks: StudioGraphProposalBlock[], proposalNodeId: string): StudioGraphProposalBlock | null {
  for (const block of blocks) {
    if (`proposal:${block.proposalNodeId}` === proposalNodeId) {
      return block;
    }
    const nested = findProposalBlock(block.children, proposalNodeId);
    if (nested) {
      return nested;
    }
  }
  return null;
}

type InspectorPanelProps = {
  contextualOnly?: boolean;
  showHeader?: boolean;
  onRevealRuntimeConsole?: () => void;
  forcedWorkspaceTab?: WorkspaceTab;
};

type WorkspaceTab = "prompt" | "config" | "output";

export function InspectorPanel({
  contextualOnly = false,
  showHeader = true,
  onRevealRuntimeConsole,
  forcedWorkspaceTab,
}: InspectorPanelProps) {
  const canonicalPrompt = useStudioStore((s) => s.canonicalPrompt);
  const nodes = useStudioStore((s) => s.nodes);
  const selectedNodeId = useStudioStore((s) => s.selectedNodeId);
  const focusedBlockId = useStudioStore((s) => s.focusedBlockId);
  const activeEditorRef = useStudioStore((s) => s.activeEditorRef);
  const editorDrafts = useStudioStore((s) => s.editorDrafts);
  const syncIssues = useStudioStore((s) => s.syncIssues);
  const updateActiveEditorDraft = useStudioStore((s) => s.updateActiveEditorDraft);
  const applyActiveEditorDraft = useStudioStore((s) => s.applyActiveEditorDraft);
  const resetActiveEditorDraft = useStudioStore((s) => s.resetActiveEditorDraft);
  const removeSelectedNode = useStudioStore((s) => s.removeSelectedNode);
  const selectedScopePromptPreview = useStudioStore((s) => s.selectedScopePromptPreview);
  const latestScopeOutputs = useStudioStore((s) => s.latestScopeOutputs);
  const selectedProposalNodeId = useStudioStore((s) => s.selectedProposalNodeId);
  const nodeLlmProfiles = useStudioStore((s) => s.nodeLlmProfiles);
  const nodeLlmProfileOrder = useStudioStore((s) => s.nodeLlmProfileOrder);
  const messageSuggestion = useStudioStore((s) => s.messageSuggestion);
  const nodeModelAssignments = useStudioStore((s) => s.nodeModelAssignments);
  const nodeModelStrategies = useStudioStore((s) => s.nodeModelStrategies);
  const graphProposals = useStudioStore((s) => s.graphProposals);
  const nodeResultHistory = useStudioStore((s) => s.nodeResultHistory);
  const consoleEvents = useStudioStore((s) => s.consoleEvents);
  const refreshSelectedScopePromptPreview = useStudioStore((s) => s.refreshSelectedScopePromptPreview);
  const runSelectedScopeRuntimeAction = useStudioStore((s) => s.runSelectedScopeRuntimeAction);
  const suggestMessagesForActiveDraft = useStudioStore((s) => s.suggestMessagesForActiveDraft);
  const applyMessageSuggestionToActiveDraft = useStudioStore((s) => s.applyMessageSuggestionToActiveDraft);
  const clearMessageSuggestion = useStudioStore((s) => s.clearMessageSuggestion);
  const setNodeModelAssignments = useStudioStore((s) => s.setNodeModelAssignments);
  const clearNodeModelAssignments = useStudioStore((s) => s.clearNodeModelAssignments);
  const setNodeModelStrategy = useStudioStore((s) => s.setNodeModelStrategy);
  const clearNodeModelStrategy = useStudioStore((s) => s.clearNodeModelStrategy);
  const selectNodeModelWinner = useStudioStore((s) => s.selectNodeModelWinner);
  const generateNodeGraphProposal = useStudioStore((s) => s.generateNodeGraphProposal);
  const applyGraphProposal = useStudioStore((s) => s.applyGraphProposal);
  const rejectGraphProposal = useStudioStore((s) => s.rejectGraphProposal);
  const applyAllNodeGraphProposals = useStudioStore((s) => s.applyAllNodeGraphProposals);
  const rejectAllNodeGraphProposals = useStudioStore((s) => s.rejectAllNodeGraphProposals);
  const restoreNodeResultHistoryEntry = useStudioStore((s) => s.restoreNodeResultHistoryEntry);
  const nodeRuntimeStates = useStudioStore((s) => s.nodeRuntimeStates);
  const nodeExecutionRecords = useStudioStore((s) => s.nodeExecutionRecords);
  const runNode = useStudioStore((s) => s.runNode);
  const stopNode = useStudioStore((s) => s.stopNode);
  const toggleNodeEnabled = useStudioStore((s) => s.toggleNodeEnabled);

  const selection = useMemo(() => {
    return resolveEditorSelection({
      canonicalPrompt,
      nodes,
      selectedNodeId,
      focusedBlockId,
      contextualOnly,
    });
  }, [canonicalPrompt, nodes, selectedNodeId, focusedBlockId, contextualOnly]);
  const draftSession = activeEditorRef ? editorDrafts[activeEditorRef] ?? null : null;
  const draft = selection && draftSession?.ref === selection.ref ? draftSession.draft : null;
  const selectedScopeOutput = selectedScopePromptPreview ? latestScopeOutputs[selectedScopePromptPreview.scope.scopeRef] ?? null : null;
  const selectedProposal = useMemo(
    () =>
      selectedProposalNodeId
        ? Object.values(graphProposals).find((proposal) => proposal.status === "preview" && findProposalBlock(proposal.blocks, selectedProposalNodeId))
        : null,
    [graphProposals, selectedProposalNodeId],
  );
  const selectedProposalBlock = useMemo(
    () => (selectedProposalNodeId && selectedProposal ? findProposalBlock(selectedProposal.blocks, selectedProposalNodeId) : null),
    [selectedProposal, selectedProposalNodeId],
  );
  const orderedNodeLlmProfiles = useMemo(
    () => nodeLlmProfileOrder.map((profileId) => nodeLlmProfiles[profileId]).filter(Boolean),
    [nodeLlmProfileOrder, nodeLlmProfiles],
  );
  const modelRouting = useMemo(() => {
    if (!selection || selection.kind === "use_prompt" || !canonicalPrompt) {
      return null;
    }

    const rootRuntimeNodeId = `prompt_root_${canonicalPrompt.metadata.id}`;
    const runtimeNodeId = selection.kind === "prompt" ? rootRuntimeNodeId : selection.block.id;
    const explicitProfileIds = nodeModelAssignments[runtimeNodeId] ?? [];
    const explicitStrategy = nodeModelStrategies[runtimeNodeId];

    if (selection.kind === "prompt") {
      return {
        runtimeNodeId,
        explicitProfileIds,
        effectiveProfileIds: explicitProfileIds,
        explicitStrategy,
        effectiveStrategy: explicitStrategy ?? { mode: "choose_best" as const },
        inheritedLabel: null as string | null,
      };
    }

    const blockPath = getPromptBlockPath(canonicalPrompt.spec.blocks, selection.block.id);
    const inheritedCandidates = [...blockPath.slice(0, -1).reverse().map((block) => block.id), rootRuntimeNodeId];
    for (const candidateNodeId of inheritedCandidates) {
      const candidateProfileIds = nodeModelAssignments[candidateNodeId];
      const candidateStrategy = nodeModelStrategies[candidateNodeId];
      if (candidateProfileIds && candidateProfileIds.length > 0) {
        return {
          runtimeNodeId,
          explicitProfileIds,
          effectiveProfileIds: explicitProfileIds.length > 0 ? explicitProfileIds : candidateProfileIds,
          explicitStrategy,
          effectiveStrategy: explicitStrategy ?? candidateStrategy ?? { mode: "choose_best" as const },
          inheritedLabel: candidateNodeId === rootRuntimeNodeId ? "root prompt" : candidateNodeId,
        };
      }
    }

    return {
      runtimeNodeId,
      explicitProfileIds,
      effectiveProfileIds: explicitProfileIds,
      explicitStrategy,
      effectiveStrategy: explicitStrategy ?? { mode: "choose_best" as const },
      inheritedLabel: null as string | null,
    };
  }, [canonicalPrompt, nodeModelAssignments, nodeModelStrategies, selection]);
  const editableModelProfileIds = useMemo(() => {
    if (!modelRouting || !selection || selection.kind === "use_prompt") {
      return [] as string[];
    }
    if (selection.kind === "prompt") {
      return modelRouting.explicitProfileIds;
    }
    return modelRouting.explicitProfileIds.length > 0 ? modelRouting.explicitProfileIds : modelRouting.effectiveProfileIds;
  }, [modelRouting, selection]);
  const canAddEditableModelProfile =
    modelRouting !== null && orderedNodeLlmProfiles.some((profile) => !editableModelProfileIds.includes(profile.id));
  const currentRuntimeNodeId = modelRouting?.runtimeNodeId ?? null;
  const activeNodeProposals = useMemo(
    () =>
      currentRuntimeNodeId
        ? Object.values(graphProposals).filter(
            (proposal) => proposal.sourceRuntimeNodeId === currentRuntimeNodeId && proposal.status === "preview",
          )
        : [],
    [currentRuntimeNodeId, graphProposals],
  );
  const currentNodeHistory = currentRuntimeNodeId ? nodeResultHistory[currentRuntimeNodeId] ?? [] : [];
  const currentRuntimeState = currentRuntimeNodeId ? nodeRuntimeStates[currentRuntimeNodeId] ?? null : null;
  const currentExecutionRecord =
    currentRuntimeState?.activeExecutionId
      ? nodeExecutionRecords[currentRuntimeState.activeExecutionId] ??
        (currentRuntimeState.lastExecutionId ? nodeExecutionRecords[currentRuntimeState.lastExecutionId] ?? null : null)
      : currentRuntimeState?.lastExecutionId
        ? nodeExecutionRecords[currentRuntimeState.lastExecutionId] ?? null
        : null;
  const latestNodeStructureEvent = useMemo(
    () =>
      currentRuntimeNodeId
        ? [...consoleEvents].reverse().find((event) => event.category === "structure" && event.nodeId === currentRuntimeNodeId) ?? null
        : null,
    [consoleEvents, currentRuntimeNodeId],
  );
  const latestNodeStructureError = latestNodeStructureEvent?.status === "error" ? latestNodeStructureEvent : null;
  const messageSuggestionInputSignature =
    draft && (draft.entityKind === "prompt" || draft.entityKind === "block") && canonicalPrompt
      ? createMessageSuggestionInputSignature({
          entityKind: draft.entityKind,
          artifactType: canonicalPrompt.spec.artifact.type,
          title: draft.title,
          description: draft.description,
          ...(draft.entityKind === "block" ? { blockKind: draft.blockKind } : {}),
        })
      : null;
  const activeMessageSuggestion =
    selection &&
    draft &&
    (draft.entityKind === "prompt" || draft.entityKind === "block") &&
    messageSuggestion.targetRef === selection.ref
      ? messageSuggestion
      : null;
  const isMessageSuggestionStale =
    Boolean(activeMessageSuggestion && messageSuggestionInputSignature && activeMessageSuggestion.inputSignature !== messageSuggestionInputSignature);

  function commitModelProfileIds(profileIds: string[]) {
    if (!modelRouting) {
      return;
    }
    const sanitizedProfileIds = profileIds.filter((profileId, index) => profileId && profileIds.indexOf(profileId) === index);
    if (sanitizedProfileIds.length === 0) {
      clearNodeModelAssignments(modelRouting.runtimeNodeId);
      return;
    }
    setNodeModelAssignments(modelRouting.runtimeNodeId, sanitizedProfileIds);
  }

  function addEditableModelProfile() {
    if (!modelRouting) {
      return;
    }
    const nextProfile = orderedNodeLlmProfiles.find((profile) => !editableModelProfileIds.includes(profile.id));
    if (!nextProfile) {
      return;
    }
    commitModelProfileIds([...editableModelProfileIds, nextProfile.id]);
  }

  function updateEditableModelProfile(index: number, profileId: string) {
    if (!modelRouting) {
      return;
    }
    const nextProfileIds = [...editableModelProfileIds];
    nextProfileIds[index] = profileId;
    commitModelProfileIds(nextProfileIds);
  }

  function removeEditableModelProfile(index: number) {
    if (!modelRouting) {
      return;
    }
    commitModelProfileIds(editableModelProfileIds.filter((_, profileIndex) => profileIndex !== index));
  }

  function setAggregatorEnabled(enabled: boolean) {
    if (!modelRouting) {
      return;
    }
    if (!enabled) {
      setNodeModelStrategy(modelRouting.runtimeNodeId, {
        mode: "choose_best",
        mergeProfileId: undefined,
        selectedWinnerProfileId: undefined,
      });
      return;
    }
    const fallbackMergeProfileId =
      editableModelProfileIds[0] ?? modelRouting.effectiveProfileIds[0] ?? orderedNodeLlmProfiles[0]?.id;
    if (!fallbackMergeProfileId) {
      return;
    }
    setNodeModelStrategy(modelRouting.runtimeNodeId, {
      mode: "merge",
      mergeProfileId: fallbackMergeProfileId,
      selectedWinnerProfileId: undefined,
    });
  }

  function updateAggregatorProfile(profileId: string) {
    if (!modelRouting) {
      return;
    }
    setNodeModelStrategy(modelRouting.runtimeNodeId, {
      mode: "merge",
      mergeProfileId: profileId,
      selectedWinnerProfileId: undefined,
    });
  }

  const evaluationSummary = canonicalPrompt?.spec.evaluation
    ? {
        reviewers: canonicalPrompt.spec.evaluation.reviewerRoles.length,
        criteria: canonicalPrompt.spec.evaluation.rubric.criteria.length,
        gates: canonicalPrompt.spec.evaluation.qualityGates.length,
      }
    : null;
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("prompt");

  useEffect(() => {
    setWorkspaceTab("prompt");
  }, [selection?.ref]);
  const activeWorkspaceTab = forcedWorkspaceTab ?? workspaceTab;
  const shouldUsePromptWorkspaceLayout =
    !selectedProposal &&
    Boolean(selection && draft && selection.kind !== "use_prompt" && activeWorkspaceTab === "prompt");

  if (shouldUsePromptWorkspaceLayout && selection && draft && draft.entityKind !== "use_prompt") {
    const structureSourceRef =
      selection.kind === "block" ? `block:${selection.block.id}` : `prompt:${canonicalPrompt?.metadata.id}`;

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-border/70 px-4 py-4">
          <div className="space-y-3">
            <details open className="rounded-md border border-border/80 bg-muted/20 p-3">
              <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-foreground">
                Node Header
              </summary>
              <div className="mt-3 space-y-3">
                <div className="grid gap-3 md:grid-cols-[minmax(0,180px)_1fr]">
                  {draft.entityKind === "block" ? (
                    <div className="space-y-1.5">
                      <Label>Kind</Label>
                      <div className="flex h-9 w-full items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-foreground">
                        {formatBlockKindLabel(draft.blockKind)}
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-1.5">
                    <Label>Title</Label>
                    <Input value={draft.title} onChange={(event) => updateActiveEditorDraft({ ...draft, title: event.target.value })} />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="default"
                    onClick={() => {
                      void suggestMessagesForActiveDraft();
                    }}
                    disabled={activeMessageSuggestion?.status === "generating"}
                  >
                    {activeMessageSuggestion?.status === "success" || activeMessageSuggestion?.status === "failure"
                      ? "Regenerate Prompt Blocks"
                      : "Suggest Prompt Blocks"}
                  </Button>
                  <Button
                    type="button"
                    onClick={applyMessageSuggestionToActiveDraft}
                    disabled={activeMessageSuggestion?.status !== "success" || activeMessageSuggestion.suggestedMessages.length === 0}
                  >
                    Apply Suggested Blocks
                  </Button>
                  {activeMessageSuggestion && activeMessageSuggestion.status !== "idle" ? (
                    <Button type="button" variant="ghost" onClick={clearMessageSuggestion}>
                      Clear
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!structureSourceRef || currentRuntimeState?.status === "running"}
                    onClick={() => generateNodeGraphProposal(structureSourceRef)}
                  >
                    {activeNodeProposals.length > 0 ? "Regenerate Child Nodes" : "Suggest Child Nodes"}
                  </Button>
                  {activeNodeProposals.length > 0 ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          if (currentRuntimeNodeId) {
                            applyAllNodeGraphProposals(currentRuntimeNodeId);
                          }
                        }}
                      >
                        Apply Child Nodes
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          if (currentRuntimeNodeId) {
                            rejectAllNodeGraphProposals(currentRuntimeNodeId);
                          }
                        }}
                      >
                        Reject Child Nodes
                      </Button>
                    </>
                  ) : null}
                </div>

                {activeMessageSuggestion ? (
                  <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-transparent">{activeMessageSuggestion.status}</Badge>
                      {isMessageSuggestionStale ? <Badge className="text-amber-300">Draft changed</Badge> : null}
                      {activeMessageSuggestion.provider ? <span>Provider: {activeMessageSuggestion.provider}</span> : null}
                      {activeMessageSuggestion.model ? <span>Model: {activeMessageSuggestion.model}</span> : null}
                      {typeof activeMessageSuggestion.executionTimeMs === "number" ? (
                        <span>Latency: {activeMessageSuggestion.executionTimeMs}ms</span>
                      ) : null}
                    </div>
                    {activeMessageSuggestion.summary ? <div>Summary: {activeMessageSuggestion.summary}</div> : null}
                    {activeMessageSuggestion.message ? <div>{activeMessageSuggestion.message}</div> : null}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Ask the model to reorganize the current prompt draft into stronger internal prompt blocks.
                  </p>
                )}
                {activeNodeProposals.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {activeNodeProposals.length} child-node proposal{activeNodeProposals.length === 1 ? "" : "s"} ready for review in the results workspace.
                  </p>
                ) : null}
              </div>
            </details>

            {draftSession?.dirty ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/80 bg-muted/20 px-3 py-2">
                <div className="text-xs text-muted-foreground">Unsaved draft changes</div>
                <Button size="sm" onClick={applyActiveEditorDraft}>
                  Save Changes
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={resetActiveEditorDraft}>
                  Discard Draft
                </Button>
              </div>
            ) : null}

            {draftSession?.validationError ? <p className="text-xs text-destructive">{draftSession.validationError}</p> : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <PromptBlockWorkspace workspaceKey={selection.ref} draft={draft} onChangeDraft={updateActiveEditorDraft} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showHeader ? (
        <div className="border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">Inspector</h2>
          <p className="mt-1 text-xs text-muted-foreground">Tree-first structured editing for canonical prompt entities.</p>
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1 p-3">
        {selectedProposal && selectedProposalBlock ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge>Proposed Block</Badge>
              <Badge className="bg-transparent">{selectedProposalBlock.kind}</Badge>
            </div>

            <Section title="Proposal" description="Preview-only structure generated by the model. It is not canonical until you apply it.">
              <div className="space-y-2">
                <div className="rounded-md border border-border bg-muted/30 px-2 py-2 text-xs">
                  <div>Source: {selectedProposal.scope.label}</div>
                  <div>Summary: {selectedProposal.summary}</div>
                  <div>Status: {selectedProposal.status}</div>
                </div>
                {selectedProposal.warnings && selectedProposal.warnings.length > 0 ? (
                  <div className="rounded-md border border-amber-300/40 bg-amber-50/40 px-2 py-2 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">Proposal warnings</div>
                    <ul className="mt-1 space-y-1">
                      {selectedProposal.warnings.map((warning, index) => (
                        <li key={`${selectedProposal.proposalId}:warning:${index}`}>- {warning}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <Label>Title</Label>
                  <PreviewValue value={selectedProposalBlock.title} />
                </div>
                {selectedProposalBlock.description ? (
                  <div className="space-y-1.5">
                    <Label>Description</Label>
                    <PreviewValue value={selectedProposalBlock.description} />
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <Label>Instruction</Label>
                  <PreviewValue value={selectedProposalBlock.instruction} />
                </div>
              </div>
            </Section>

            <div className="grid grid-cols-2 gap-2">
              <Button type="button" onClick={() => applyGraphProposal(selectedProposal.proposalId)}>
                Apply
              </Button>
              <Button type="button" variant="outline" onClick={() => rejectGraphProposal(selectedProposal.proposalId)}>
                Reject
              </Button>
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={() => generateNodeGraphProposal(selectedProposal.sourceNodeId)}>
              Regenerate From Source
            </Button>
          </div>
        ) : !selection || !draft ? (
          <p className="text-sm text-muted-foreground">Select the root prompt, a block, or a dependency to edit canonical fields.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge>{selection.kind === "prompt" ? "Root Prompt" : selection.kind === "block" ? "Prompt Block" : "Use Prompt"}</Badge>
              {selection.kind === "block" ? <Badge className="bg-transparent">{selection.block.id}</Badge> : null}
              {draftSession?.validationError ? (
                <Badge className="text-destructive">Invalid</Badge>
              ) : draftSession?.dirty ? (
                <Badge className="text-amber-300">Dirty</Badge>
              ) : (
                <Badge className="text-emerald-300">Clean</Badge>
              )}
            </div>

            {draft.entityKind === "use_prompt" ? (
              <>
                <Section title="General" description="Root-level prompt composition dependency.">
                  <div className="space-y-2">
                    <div className="space-y-1.5">
                      <Label>Prompt ID</Label>
                      <Input value={draft.prompt} onChange={(event) => updateActiveEditorDraft({ ...draft, prompt: event.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Mode</Label>
                      <select
                        className="h-9 w-full rounded-md border border-input bg-muted/40 px-3 py-1 text-sm text-foreground"
                        value={draft.mode}
                        onChange={(event) => updateActiveEditorDraft({ ...draft, mode: event.target.value })}
                      >
                        <option value="">(unset)</option>
                        <option value="inline">inline</option>
                        <option value="locked">locked</option>
                        <option value="overrideable">overrideable</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Version</Label>
                      <Input value={draft.version} onChange={(event) => updateActiveEditorDraft({ ...draft, version: event.target.value })} />
                    </div>
                  </div>
                </Section>

                <Button className="w-full" onClick={applyActiveEditorDraft}>
                  Apply Dependency Patch
                </Button>
                <Button type="button" variant="outline" className="w-full" onClick={resetActiveEditorDraft} disabled={!draftSession?.dirty}>
                  Reset Draft
                </Button>
                <Button type="button" variant="outline" className="w-full" onClick={removeSelectedNode}>
                  Remove Dependency
                </Button>
              </>
            ) : (
              <>
                {selection.kind !== "use_prompt" && !forcedWorkspaceTab ? (
                  <div className="space-y-3">
                    <div className="rounded-md border border-border/80 bg-muted/20 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-foreground">Node Workspace</div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Sprint 6 foundation: prompt authoring, execution config, and runtime output now live in separate node tabs.
                      </p>
                    </div>
                    <Tabs value={workspaceTab} onValueChange={(value) => setWorkspaceTab(value as WorkspaceTab)}>
                      <TabsList className="w-full justify-start">
                        <TabsTrigger value="prompt">Prompt</TabsTrigger>
                        <TabsTrigger value="config">Config</TabsTrigger>
                        <TabsTrigger value="output">Output</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                ) : null}

                {activeWorkspaceTab === "config" ? (
                  <div className="rounded-md border border-border/80 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    Configuration changes routing, artifact output, and evaluation behavior. Prompt content lives in the <span className="font-medium text-foreground">Prompt</span> tab.
                  </div>
                ) : null}

                {selection.kind !== "use_prompt" && activeWorkspaceTab === "config" ? (
                  <Section title="Model Routing" description="Choose which model profiles execute this node and whether results are merged or compared.">
                    {modelRouting ? (
                      <div className="space-y-3">
                        <div className="rounded-md border border-border bg-muted/30 px-2 py-2 text-xs">
                          {selection.kind === "prompt" ? (
                            <div>Root models apply to all descendants until a child overrides them.</div>
                          ) : modelRouting.explicitProfileIds.length > 0 ? (
                            <div>This node uses its own model selection.</div>
                          ) : modelRouting.inheritedLabel ? (
                            <div>Currently inheriting models from {modelRouting.inheritedLabel}.</div>
                          ) : (
                            <div>No models selected yet on this node or its ancestors.</div>
                          )}
                        </div>

                        {orderedNodeLlmProfiles.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No global model profiles exist yet. Create them from the left Models panel.</p>
                        ) : (
                          <div className="space-y-2">
                            {editableModelProfileIds.map((profileId, index) => {
                              const availableProfiles = orderedNodeLlmProfiles.filter(
                                (profile) =>
                                  profile.id === profileId ||
                                  !editableModelProfileIds.some(
                                    (selectedProfileId, selectedIndex) =>
                                      selectedIndex !== index && selectedProfileId === profile.id,
                                  ),
                              );
                              return (
                                <div key={`${modelRouting.runtimeNodeId}:profile:${index}`} className="flex items-center gap-2">
                                  <select
                                    className="h-9 w-full rounded-md border border-input bg-muted/40 px-3 py-1 text-sm text-foreground"
                                    value={profileId}
                                    onChange={(event) => updateEditableModelProfile(index, event.target.value)}
                                  >
                                    {availableProfiles.map((profile) => (
                                      <option key={profile.id} value={profile.id}>
                                        {profile.name} ({profile.settings.model})
                                      </option>
                                    ))}
                                  </select>
                                  <Button type="button" variant="outline" size="sm" onClick={() => removeEditableModelProfile(index)}>
                                    Remove
                                  </Button>
                                </div>
                              );
                            })}

                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={addEditableModelProfile}
                              disabled={!canAddEditableModelProfile}
                            >
                              + Add Model
                            </Button>
                          </div>
                        )}

                        <div className="space-y-2 rounded-md border border-border/70 p-2">
                          <label className="flex items-center gap-2 text-sm text-foreground">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-input"
                              checked={modelRouting.effectiveStrategy.mode === "merge"}
                              disabled={modelRouting.effectiveStrategy.mode !== "merge" && editableModelProfileIds.length < 2}
                              onChange={(event) => setAggregatorEnabled(event.target.checked)}
                            />
                            Use Aggregator Model
                          </label>
                          {editableModelProfileIds.length < 2 ? (
                            <p className="text-xs text-muted-foreground">Add at least two models to enable aggregation. Without an aggregator, the run stores separate answers and you choose the winner below.</p>
                          ) : null}
                          {modelRouting.effectiveStrategy.mode === "merge" ? (
                            <div className="space-y-1.5">
                              <Label>Aggregator Model</Label>
                              <select
                                className="h-9 w-full rounded-md border border-input bg-muted/40 px-3 py-1 text-sm text-foreground"
                                value={modelRouting.effectiveStrategy.mergeProfileId ?? editableModelProfileIds[0] ?? ""}
                                onChange={(event) => updateAggregatorProfile(event.target.value)}
                              >
                                {orderedNodeLlmProfiles.map((profile) => (
                                  <option key={profile.id} value={profile.id}>
                                    {profile.name} ({profile.settings.model})
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}
                        </div>

                        {selection.kind === "block" ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => clearNodeModelAssignments(modelRouting.runtimeNodeId)}
                              disabled={modelRouting.explicitProfileIds.length === 0}
                            >
                              Use Inherited Models
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => clearNodeModelStrategy(modelRouting.runtimeNodeId)}
                              disabled={!modelRouting.explicitStrategy}
                            >
                              Use Inherited Aggregation
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Model routing is only available for root and block nodes.</p>
                    )}
                  </Section>
                ) : null}

                {selection.kind !== "use_prompt" && activeWorkspaceTab === "output" && currentRuntimeNodeId ? (
                  <Section title="Child Node Suggestions" description="Suggest preview-only child nodes from this scope. This does not modify the current prompt blocks inside the node.">
                    <div className="space-y-2">
                      <div className="rounded-md border border-border bg-muted/30 px-2 py-2 text-xs">
                        <div>Active proposals: {activeNodeProposals.length}</div>
                        <div>History entries: {currentNodeHistory.length}</div>
                      </div>
                      {currentExecutionRecord?.mode === "structure" &&
                      (currentExecutionRecord.status === "running" || currentExecutionRecord.status === "cancel_requested") ? (
                        <div className="space-y-2 rounded-md border border-blue-300/40 bg-blue-50/30 px-2 py-2 text-xs text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <Badge className="bg-blue-100 text-blue-800">
                              {currentExecutionRecord.status === "cancel_requested" ? "stopping" : "streaming"}
                            </Badge>
                            {currentExecutionRecord.model ? <span>{currentExecutionRecord.model}</span> : null}
                            {currentExecutionRecord.finishReason ? <span>finish={currentExecutionRecord.finishReason}</span> : null}
                          </div>
                          <div>
                            Streaming structure response from the model. If it stops mid-JSON, this preview helps show where the response was truncated.
                          </div>
                          {typeof currentExecutionRecord.output === "string" && currentExecutionRecord.output.trim().length > 0 ? (
                            <PreviewValue value={currentExecutionRecord.output} />
                          ) : (
                            <div>No streamed text received yet.</div>
                          )}
                        </div>
                      ) : null}
                      <div className="rounded-md border border-amber-300/40 bg-amber-50/40 px-2 py-2 text-xs text-muted-foreground">
                        Use this when you want the model to suggest child graph nodes. Use <span className="font-medium text-foreground">Execute Prompt</span> on the right when you want actual content output for this node.
                      </div>
                      {latestNodeStructureError ? (
                        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-2 text-xs">
                          <div className="font-medium text-destructive">Latest child-node suggestion failed</div>
                          <div className="text-muted-foreground">{new Date(latestNodeStructureError.createdAt).toLocaleTimeString()}</div>
                          <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-destructive">{latestNodeStructureError.message}</pre>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="border-amber-300/70 bg-amber-50/40 text-amber-900 hover:bg-amber-100"
                              onClick={() => generateNodeGraphProposal(selection.kind === "prompt" ? `prompt:${canonicalPrompt?.metadata.id}` : `block:${selection.block.id}`)}
                            >
                              Retry Child Nodes
                            </Button>
                            {onRevealRuntimeConsole ? (
                              <Button type="button" variant="outline" size="sm" onClick={onRevealRuntimeConsole}>
                                Open Console
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        Use the header above to suggest, apply, or reject child nodes. This panel only reviews the resulting proposals.
                      </p>
                      {activeNodeProposals.length > 0 ? (
                        <div className="space-y-2">
                          {activeNodeProposals.map((proposal) => (
                            <div key={proposal.proposalId} className="rounded-md border border-border bg-muted/20 p-2 text-xs">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="font-medium text-foreground">{proposal.summary}</div>
                                <Badge className="bg-transparent">preview</Badge>
                                <Badge className="bg-transparent">{proposal.blocks.length} block{proposal.blocks.length === 1 ? "" : "s"}</Badge>
                              </div>
                              <div className="mt-1 text-muted-foreground">{new Date(proposal.createdAt).toLocaleTimeString()}</div>
                              {proposal.warnings && proposal.warnings.length > 0 ? (
                                <div className="mt-2 rounded-md border border-amber-300/40 bg-amber-50/40 px-2 py-2 text-muted-foreground">
                                  <div className="font-medium text-foreground">{proposal.warnings.length} warning{proposal.warnings.length === 1 ? "" : "s"}</div>
                                  <ul className="mt-1 space-y-1">
                                    {proposal.warnings.map((warning, index) => (
                                      <li key={`${proposal.proposalId}:list-warning:${index}`}>- {warning}</li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No preview proposals for this node yet.</p>
                      )}
                    </div>
                  </Section>
                ) : null}

                {activeWorkspaceTab === "config" && draft.entityKind === "prompt" ? (
                  <>
                    <Section title="Artifact Output" description="Control the artifact type and primary build target for this prompt.">
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label>Artifact Type</Label>
                          <select
                            className="h-9 w-full rounded-md border border-input bg-muted/40 px-3 py-1 text-sm text-foreground"
                            value={draft.artifactType}
                            onChange={(event) => {
                              const nextArtifactType = event.target.value as Prompt["spec"]["artifact"]["type"];
                              const defaultBuildTarget = getBuildTargetOptionsForArtifact(nextArtifactType)[0]?.value ?? "";
                              updateActiveEditorDraft({ ...draft, artifactType: nextArtifactType, buildTarget: defaultBuildTarget });
                            }}
                          >
                            <option value={ArtifactType.Code}>Code</option>
                            <option value={ArtifactType.BookText}>Book</option>
                            <option value={ArtifactType.Instruction}>Instruction</option>
                            <option value={ArtifactType.Story}>Story</option>
                            <option value={ArtifactType.Course}>Course</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>{getBuildTargetHelperLabel(draft.artifactType)}</Label>
                          <select
                            className="h-9 w-full rounded-md border border-input bg-muted/40 px-3 py-1 text-sm text-foreground"
                            value={draft.buildTarget}
                            onChange={(event) => updateActiveEditorDraft({ ...draft, buildTarget: event.target.value })}
                          >
                            {getBuildTargetOptionsForArtifact(draft.artifactType).map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="rounded-md border border-border bg-muted/30 px-2 py-2 text-xs">
                          <div>Format: {selection.prompt.spec.buildTargets[0]?.format ?? "(none)"}</div>
                          <div>Output Path: {selection.prompt.spec.buildTargets[0]?.outputPath ?? "(none)"}</div>
                          <div>Additional Targets: {Math.max(selection.prompt.spec.buildTargets.length - 1, 0)}</div>
                        </div>
                      </div>
                    </Section>
                  </>
                ) : activeWorkspaceTab === "config" ? (
                  <>
                    <Section title="Artifact Output" description="Block nodes inherit artifact and build settings from the root prompt.">
                      <div className="rounded-md border border-border bg-muted/30 px-2 py-2 text-xs">
                        <div>Artifact Type: {selection.prompt.spec.artifact.type}</div>
                        <div>{selection.prompt.spec.buildTargets[0] ? `Primary Build Target: ${selection.prompt.spec.buildTargets[0]?.id}` : "No build target configured"}</div>
                        <div>Format: {selection.prompt.spec.buildTargets[0]?.format ?? "(none)"}</div>
                        <div>Output Path: {selection.prompt.spec.buildTargets[0]?.outputPath ?? "(none)"}</div>
                        <div className="mt-2">Root build remains authoritative. Use prompt execution to test this block in context.</div>
                      </div>
                    </Section>
                  </>
                ) : null}

                {activeWorkspaceTab === "config" ? (
                <Section title="Evaluation" description="Reviewer roles, rubric criteria, and quality gates for prompt evaluation.">
                  {draft.entityKind === "prompt" ? (
                    <div className="space-y-2">
                      <div className="space-y-1.5">
                        <Label>Evaluation Enabled</Label>
                        <select
                          className="h-9 w-full rounded-md border border-input bg-muted/40 px-3 py-1 text-sm text-foreground"
                          value={String(draft.evaluationEnabled)}
                          onChange={(event) =>
                            updateActiveEditorDraft({
                              ...draft,
                              evaluationEnabled: event.target.value === "true",
                            })
                          }
                        >
                          <option value="false">disabled</option>
                          <option value="true">enabled</option>
                        </select>
                      </div>

                      {draft.evaluationEnabled ? (
                        <>
                          <div className="space-y-1.5">
                            <Label>Reviewer Roles JSON</Label>
                            <Textarea
                              value={draft.reviewerRolesJson}
                              placeholder='[{"id":"manager"}]'
                              onChange={(event) => updateActiveEditorDraft({ ...draft, reviewerRolesJson: event.target.value })}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Rubric Criteria JSON</Label>
                            <Textarea
                              value={draft.criteriaJson}
                              placeholder='[{"id":"correctness","title":"Correctness","weight":1,"maxScore":5}]'
                              onChange={(event) => updateActiveEditorDraft({ ...draft, criteriaJson: event.target.value })}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Quality Gates JSON</Label>
                            <Textarea
                              value={draft.qualityGatesJson}
                              placeholder='[{"metric":"overall","operator":">=","threshold":0}]'
                              onChange={(event) => updateActiveEditorDraft({ ...draft, qualityGatesJson: event.target.value })}
                            />
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">Enable evaluation when this prompt should be reviewed through explicit reviewer roles and rubric gates.</p>
                      )}
                    </div>
                  ) : evaluationSummary ? (
                    <div className="rounded-md border border-border bg-muted/30 px-2 py-2 text-xs">
                      <div>Reviewers: {evaluationSummary.reviewers}</div>
                      <div>Criteria: {evaluationSummary.criteria}</div>
                      <div>Quality Gates: {evaluationSummary.gates}</div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No evaluation spec is configured on the root prompt.</p>
                  )}
                </Section>
                ) : null}

                {selection.kind !== "use_prompt" && activeWorkspaceTab === "output" && selectedScopePromptPreview ? (
                  <>
                    <Section title="Rendered Prompt" description="Resolved prompt text for the currently selected scope.">
                      <div className="space-y-2">
                        <div className="rounded-md border border-border bg-muted/30 px-2 py-2 text-xs">
                          <div>Scope: {selectedScopePromptPreview.scope.label}</div>
                          <div>Inherited messages: {selectedScopePromptPreview.inheritedMessageCount}</div>
                          <div>Selected messages: {selectedScopePromptPreview.selectedMessageCount}</div>
                          <div>Inputs: {selectedScopePromptPreview.inputNames.join(", ") || "(none)"}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={refreshSelectedScopePromptPreview}>
                            Preview Prompt
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => runSelectedScopeRuntimeAction("resolve")}>
                            Resolve {selectedScopePromptPreview.scope.mode === "block" ? "Block" : "Root"}
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => runSelectedScopeRuntimeAction("evaluate")}>
                            Evaluate {selectedScopePromptPreview.scope.mode === "block" ? "Block" : "Root"}
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => runSelectedScopeRuntimeAction("blueprint")}>
                            Blueprint {selectedScopePromptPreview.scope.mode === "block" ? "Block" : "Root"}
                          </Button>
                        </div>
                        {selectedScopePromptPreview.renderedText ? (
                          <PreviewValue value={selectedScopePromptPreview.renderedText} />
                        ) : (
                          <p className="text-xs text-muted-foreground">Rendered prompt text is not available for this scope.</p>
                        )}
                        {selectedScopePromptPreview.issues.length > 0 ? (
                          <div className="space-y-1">
                            {selectedScopePromptPreview.issues.map((issue, index) => (
                              <p key={`${issue.filepath}:${index}`} className="text-xs text-destructive">
                                {issue.message}
                              </p>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </Section>

                  <Section title="Latest Output" description="Last stored runtime result for the selected scope.">
                      {selectedScopeOutput ? (
                        <div className="space-y-2">
                          <div className="rounded-md border border-border bg-muted/30 px-2 py-2 text-xs">
                          <div>Action: {selectedScopeOutput.action}</div>
                          <div>Type: {selectedScopeOutput.contentType}</div>
                          <div>Generated: {new Date(selectedScopeOutput.generatedAt).toLocaleTimeString()}</div>
                          {selectedScopeOutput.metadata?.provider ? <div>Provider: {String(selectedScopeOutput.metadata.provider)}</div> : null}
                          {selectedScopeOutput.metadata?.model ? <div>Model: {String(selectedScopeOutput.metadata.model)}</div> : null}
                          {selectedScopeOutput.metadata?.executionTimeMs ? (
                            <div>Latency: {String(selectedScopeOutput.metadata.executionTimeMs)}ms</div>
                          ) : null}
                          {selectedScopeOutput.metadata?.executionMode ? (
                            <div>Mode: {String(selectedScopeOutput.metadata.executionMode)}</div>
                          ) : null}
                        </div>
                          {selectedScopeOutput.contentType === "graph_proposal" ? (
                            <div className="space-y-2">
                              <div className="rounded-md border border-amber-300/40 bg-amber-50/40 px-2 py-2 text-xs text-muted-foreground">
                                This result is a structure proposal preview, not generated node text. Use <span className="font-medium text-foreground">Generate Text</span> in Node Execution if you want content output.
                              </div>
                              <div className="rounded-md border border-border bg-muted/20 p-2 text-xs">
                                <div>Summary: {String((selectedScopeOutput.metadata?.summary as string | undefined) ?? "Structure proposal ready.")}</div>
                                <div>
                                  Proposed blocks: {Array.isArray((selectedScopeOutput.content as { blocks?: unknown[] } | null)?.blocks)
                                    ? ((selectedScopeOutput.content as { blocks: unknown[] }).blocks.length)
                                    : 0}
                                </div>
                              </div>
                              {Array.isArray((selectedScopeOutput.content as { warnings?: unknown[] } | null)?.warnings) &&
                              ((selectedScopeOutput.content as { warnings: unknown[] }).warnings.length > 0) ? (
                                <div className="rounded-md border border-amber-300/40 bg-amber-50/40 px-2 py-2 text-xs text-muted-foreground">
                                  <div className="font-medium text-foreground">Proposal warnings</div>
                                  <ul className="mt-1 space-y-1">
                                    {((selectedScopeOutput.content as { warnings: unknown[] }).warnings).map((warning, index) => (
                                      <li key={`latest-output-warning:${index}`}>- {String(warning)}</li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                              <PreviewValue value={selectedScopeOutput.content} />
                            </div>
                          ) : null}
                          {Array.isArray(selectedScopeOutput.metadata?.variants) ? (
                            <div className="space-y-2">
                              {(selectedScopeOutput.metadata.variants as Array<{
                                profileId: string;
                                profileName: string;
                                model: string;
                                outputText: string;
                              }>).map((variant) => (
                                <div key={variant.profileId} className="rounded-md border border-border bg-muted/20 p-2">
                                  <div className="mb-2 flex items-center justify-between gap-2">
                                    <div className="text-xs font-medium text-foreground">
                                      {variant.profileName} • {variant.model}
                                    </div>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() =>
                                        modelRouting ? selectNodeModelWinner(modelRouting.runtimeNodeId, variant.profileId) : undefined
                                      }
                                    >
                                      {selectedScopeOutput.metadata?.selectedWinnerProfileId === variant.profileId ? "Selected" : "Choose This"}
                                    </Button>
                                  </div>
                                  <PreviewValue value={variant.outputText} />
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {selectedScopeOutput.contentType !== "graph_proposal" ? <PreviewValue value={selectedScopeOutput.content} /> : null}
                          {selectedScopeOutput.issues.length > 0 ? (
                            <div className="space-y-1">
                              {selectedScopeOutput.issues.map((issue, index) => (
                                <p key={`${issue.filepath}:${index}`} className="text-xs text-destructive">
                                  {issue.message}
                                </p>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No stored output for this scope yet.</p>
                      )}
                    </Section>

                    <Section title="Result History" description="Previous outputs and proposals for this node. Restore any earlier result as the active one.">
                      {currentNodeHistory.length > 0 ? (
                        <div className="space-y-2">
                          {currentNodeHistory.map((entry) => (
                            <div key={entry.historyEntryId} className="rounded-md border border-border bg-muted/20 p-2">
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <div className="text-xs text-foreground">
                                  {entry.resultKind} • {new Date(entry.createdAt).toLocaleTimeString()}
                                  {entry.active ? " • active" : ""}
                                </div>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => (currentRuntimeNodeId ? restoreNodeResultHistoryEntry(currentRuntimeNodeId, entry.historyEntryId) : undefined)}
                                >
                                  Restore
                                </Button>
                              </div>
                              {entry.output.contentType === "graph_proposal" &&
                              Array.isArray((entry.output.content as { warnings?: unknown[] } | null)?.warnings) &&
                              ((entry.output.content as { warnings: unknown[] }).warnings.length > 0) ? (
                                <div className="mb-2 rounded-md border border-amber-300/40 bg-amber-50/40 px-2 py-2 text-xs text-muted-foreground">
                                  {((entry.output.content as { warnings: unknown[] }).warnings.length)} warning{((entry.output.content as { warnings: unknown[] }).warnings.length) === 1 ? "" : "s"}
                                </div>
                              ) : null}
                              <PreviewValue value={entry.output.contentType === "graph_proposal" ? entry.output.metadata?.summary ?? entry.output.content : entry.output.content} />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No stored history for this node yet.</p>
                      )}
                    </Section>

                    <Section title="Node Execution" description="Generate actual text output for this node. This is separate from structure proposal generation.">
                      <div className="space-y-3">
                        {(() => {
                          const runtimeNodeId =
                            selection.kind === "prompt" && canonicalPrompt
                              ? `prompt_root_${canonicalPrompt.metadata.id}`
                              : selection.kind === "block"
                                ? selection.block.id
                                : null;
                          const runtimeState = runtimeNodeId ? nodeRuntimeStates[runtimeNodeId] : null;
                          const executionRecord =
                            runtimeState?.lastExecutionId ? nodeExecutionRecords[runtimeState.lastExecutionId] ?? null : null;
                          if (!runtimeState) return <p className="text-xs text-muted-foreground">No runtime state available.</p>;
                          const runtimeLabel =
                            runtimeState.status === "running" && runtimeState.cancelRequestedAt ? "stopping" : runtimeState.status;

                          return (
                            <>
                              {activeNodeProposals.length > 0 && currentRuntimeNodeId ? (
                                <div className="rounded-md border border-amber-300/40 bg-amber-50/40 px-2 py-2 text-xs text-muted-foreground">
                                  <div>
                                    {activeNodeProposals.length} unapplied structure proposal{activeNodeProposals.length === 1 ? "" : "s"} still preview-only for this node.
                                    <span className="font-medium text-foreground"> Generate Text</span> will ignore them until you apply or reject the preview.
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <Button type="button" variant="outline" size="sm" onClick={() => applyAllNodeGraphProposals(currentRuntimeNodeId)}>
                                      Apply Structure First
                                    </Button>
                                    <Button type="button" variant="outline" size="sm" onClick={() => rejectAllNodeGraphProposals(currentRuntimeNodeId)}>
                                      Reject Preview
                                    </Button>
                                    {onRevealRuntimeConsole ? (
                                      <Button type="button" variant="outline" size="sm" onClick={onRevealRuntimeConsole}>
                                        Open Console
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                              <div className="rounded-md border border-emerald-300/40 bg-emerald-50/40 px-2 py-2 text-xs text-muted-foreground">
                                Use <span className="font-medium text-foreground">Generate Text</span> to produce content for this node. This does not create child proposal nodes.
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge
                                  className={
                                    runtimeState.status === "success"
                                      ? "bg-green-100 text-green-800"
                                      : runtimeState.status === "error"
                                        ? "bg-red-100 text-red-800"
                                        : runtimeState.status === "running"
                                          ? "bg-blue-100 text-blue-800"
                                          : runtimeState.status === "stale"
                                            ? "bg-yellow-100 text-yellow-800"
                                            : "bg-gray-100 text-gray-800"
                                  }
                                >
                                  {runtimeLabel}
                                </Badge>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="border-emerald-300/70 bg-emerald-50/40 text-emerald-900 hover:bg-emerald-100"
                                  onClick={() => runNode(selectedNodeId!)}
                                  disabled={runtimeState.status === "running"}
                                >
                                  Generate Text
                                </Button>
                                {runtimeState.status === "running" ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => stopNode(selectedNodeId!)}
                                    disabled={Boolean(runtimeState.cancelRequestedAt)}
                                  >
                                    {runtimeState.cancelRequestedAt ? "Stopping" : "Stop"}
                                  </Button>
                                ) : null}
                                {selection.kind === "block" ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => toggleNodeEnabled(selectedNodeId!)}
                                  >
                                    {runtimeState.enabled ? "Disable" : "Enable"}
                                  </Button>
                                ) : null}
                              </div>
                              {selection.kind === "block" ? (
                                <div className="text-xs text-muted-foreground">Assembly: {runtimeState.enabled ? "enabled" : "disabled"}</div>
                              ) : null}
                              {runtimeState.lastRunAt && (
                                <div className="text-xs text-muted-foreground">
                                  Last run: {new Date(runtimeState.lastRunAt).toLocaleTimeString()}
                                </div>
                              )}
                              {runtimeState.startedAt && runtimeState.status === "running" ? (
                                <div className="text-xs text-muted-foreground">
                                  Started: {new Date(runtimeState.startedAt).toLocaleTimeString()}
                                </div>
                              ) : null}
                              {runtimeState.cancelRequestedAt ? (
                                <div className="text-xs text-muted-foreground">
                                  Stop requested: {new Date(runtimeState.cancelRequestedAt).toLocaleTimeString()}
                                </div>
                              ) : null}
                              {executionRecord?.provider ? (
                                <div className="text-xs text-muted-foreground">
                                  Provider: {executionRecord.provider}
                                  {executionRecord.model ? ` • ${executionRecord.model}` : ""}
                                  {executionRecord.finishReason ? ` • finish=${executionRecord.finishReason}` : ""}
                                  {executionRecord.executionTimeMs !== undefined ? ` • ${executionRecord.executionTimeMs}ms` : ""}
                                </div>
                              ) : null}
                              {executionRecord?.mode === "structure" && executionRecord.status === "error" ? (
                                <div className="rounded-md border border-amber-300/40 bg-amber-50/40 px-2 py-2 text-xs text-muted-foreground">
                                  <div>
                                    The last failed execution for this node was <span className="font-medium text-foreground">structure generation</span>, not text generation.
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="border-amber-300/70 bg-amber-50/40 text-amber-900 hover:bg-amber-100"
                                      onClick={() =>
                                        generateNodeGraphProposal(
                                          selection.kind === "prompt" ? `prompt:${canonicalPrompt?.metadata.id}` : `block:${selection.block.id}`,
                                        )
                                      }
                                    >
                                      Retry Structure
                                    </Button>
                                    {onRevealRuntimeConsole ? (
                                      <Button type="button" variant="outline" size="sm" onClick={onRevealRuntimeConsole}>
                                        Open Console
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                              {runtimeState.output && <PreviewValue value={runtimeState.output} />}
                            </>
                          );
                        })()}
                      </div>
                    </Section>
                  </>
                ) : null}

                {draftSession?.dirty ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/80 bg-muted/20 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Unsaved draft changes</div>
                    <Button size="sm" onClick={applyActiveEditorDraft}>
                      Save Changes
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={resetActiveEditorDraft}>
                      Discard Draft
                    </Button>
                  </div>
                ) : null}

                {draft.entityKind === "block" ? (
                  <Button type="button" variant="outline" className="w-full" onClick={removeSelectedNode}>
                    Remove Block
                  </Button>
                ) : null}
              </>
            )}

            {draftSession?.validationError ? <p className="text-xs text-destructive">{draftSession.validationError}</p> : null}

            {syncIssues.length > 0 ? (
              <Section title="Sync issues">
                {syncIssues.map((issue) => (
                  <p key={issue} className="text-xs text-destructive">
                    {issue}
                  </p>
                ))}
              </Section>
            ) : null}

            <Separator />
            <p className="text-[11px] text-muted-foreground">
              Structural entities stay on the tree/canvas. Configuration is edited here and validated against the canonical prompt schema.
            </p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
