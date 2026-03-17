import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Copy, Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { ScrollArea } from "../components/ui/scroll-area";
import { useStudioStore } from "../state/studioStore";
import { compilePromptWorkspaceBlocks, createPromptWorkspaceBlocks } from "../inspector/promptDocumentAdapter";
import { resolveEditorSelection } from "../inspector/editorSession";
import { findPromptBlockById } from "../model/promptTree";
import type { Prompt, PromptBlock } from "@promptfarm/core";
import type { StudioGraphProposal, StudioGraphProposalBlock, StudioNodeResultHistoryEntry } from "../graph/types";
import {
  readStudioPromptDocumentFromLocalCacheSnapshot,
  readStudioPromptDocumentFromRemote,
  type StudioPromptDocumentRecord,
} from "../runtime/studioPromptDocumentRemote";
import { createRenderedPromptPreview } from "../runtime/scopeRuntime";

function copyText(text: string) {
  void navigator.clipboard.writeText(text);
}

function renderHistoryPreview(entry: StudioNodeResultHistoryEntry): string {
  if (entry.output.contentType === "graph_proposal") {
    const summary = typeof entry.output.metadata?.summary === "string" ? entry.output.metadata.summary : null;
    return summary ?? "Structure proposal";
  }
  if (typeof entry.output.content === "string") {
    return entry.output.content;
  }
  return JSON.stringify(entry.output.content, null, 2);
}

function findProposalBlockPath(
  blocks: StudioGraphProposalBlock[],
  targetProposalNodeId: string,
  path: StudioGraphProposalBlock[] = [],
): StudioGraphProposalBlock[] | null {
  for (const block of blocks) {
    const nextPath = [...path, block];
    if (block.proposalNodeId === targetProposalNodeId) {
      return nextPath;
    }
    const nested = findProposalBlockPath(block.children, targetProposalNodeId, nextPath);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function findCanonicalBlockIdForAppliedProposal(
  prompt: Prompt | null,
  proposal: StudioGraphProposal,
  proposalNodeId: string,
): string | null {
  if (!prompt) {
    return null;
  }

  const proposalPath = findProposalBlockPath(proposal.blocks, proposalNodeId);
  if (!proposalPath) {
    return null;
  }

  let siblings: PromptBlock[] =
    proposal.scope.mode === "block" && proposal.scope.blockId
      ? findPromptBlockById(prompt.spec.blocks, proposal.scope.blockId)?.children ?? []
      : prompt.spec.blocks;
  let matchedBlock: PromptBlock | null = null;

  for (const proposalBlock of proposalPath) {
    matchedBlock = siblings.find((candidate) => candidate.kind === proposalBlock.kind && candidate.title === proposalBlock.title) ?? null;
    if (!matchedBlock) {
      return null;
    }
    siblings = matchedBlock.children;
  }

  return matchedBlock?.id ?? null;
}

function renderProposalBlockTree(input: {
  blocks: StudioGraphProposalBlock[];
  depth?: number;
  onSelect?: (proposalNodeId: string) => void;
}): ReactNode {
  const depth = input.depth ?? 0;
  return (
    <ul className={depth === 0 ? "mt-3 space-y-2" : "mt-2 space-y-2 border-l border-border/60 pl-4"}>
      {input.blocks.map((block) => (
        <li key={block.proposalNodeId} className="space-y-1">
          <button
            type="button"
            className="w-full rounded-lg border border-border/60 bg-background/20 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-background/40"
            onClick={() => input.onSelect?.(block.proposalNodeId)}
          >
            <span className="text-sm font-medium text-foreground">{block.title}</span>
            <Badge className="ml-2 bg-transparent">{block.kind}</Badge>
            {block.description ? <div className="mt-1 text-xs text-muted-foreground">{block.description}</div> : null}
          </button>
          {block.children.length > 0 ? renderProposalBlockTree({ blocks: block.children, depth: depth + 1, onSelect: input.onSelect }) : null}
        </li>
      ))}
    </ul>
  );
}

function renderCanonicalBlockTree(input: {
  blocks: PromptBlock[];
  depth?: number;
  onSelect?: (blockId: string) => void;
}): ReactNode {
  const depth = input.depth ?? 0;
  return (
    <ul className={depth === 0 ? "mt-3 space-y-2" : "mt-2 space-y-2 border-l border-border/60 pl-4"}>
      {input.blocks.map((block) => (
        <li key={block.id} className="space-y-1">
          <button
            type="button"
            className="w-full rounded-lg border border-border/60 bg-background/20 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-background/40"
            onClick={() => input.onSelect?.(block.id)}
          >
            <span className="text-sm font-medium text-foreground">{block.title}</span>
            <Badge className="ml-2 bg-transparent">{block.kind}</Badge>
            <div className="mt-1 text-xs text-muted-foreground">{block.children.length} child{block.children.length === 1 ? "" : "ren"}</div>
            {block.description ? <div className="mt-1 text-xs text-muted-foreground">{block.description}</div> : null}
          </button>
          {block.children.length > 0 ? renderCanonicalBlockTree({ blocks: block.children, depth: depth + 1, onSelect: input.onSelect }) : null}
        </li>
      ))}
    </ul>
  );
}

export function NodeWorkspaceResultsPanel() {
  const canonicalPrompt = useStudioStore((s) => s.canonicalPrompt);
  const nodes = useStudioStore((s) => s.nodes);
  const selectedNodeId = useStudioStore((s) => s.selectedNodeId);
  const focusedBlockId = useStudioStore((s) => s.focusedBlockId);
  const activeEditorRef = useStudioStore((s) => s.activeEditorRef);
  const editorDrafts = useStudioStore((s) => s.editorDrafts);
  const selectedScopePromptPreview = useStudioStore((s) => s.selectedScopePromptPreview);
  const latestScopeOutputs = useStudioStore((s) => s.latestScopeOutputs);
  const runNode = useStudioStore((s) => s.runNode);
  const stopNode = useStudioStore((s) => s.stopNode);
  const setSelectedProposalNodeId = useStudioStore((s) => s.setSelectedProposalNodeId);
  const focusBlock = useStudioStore((s) => s.focusBlock);
  const nodeRuntimeStates = useStudioStore((s) => s.nodeRuntimeStates);
  const graphProposals = useStudioStore((s) => s.graphProposals);
  const applyAllNodeGraphProposals = useStudioStore((s) => s.applyAllNodeGraphProposals);
  const rejectAllNodeGraphProposals = useStudioStore((s) => s.rejectAllNodeGraphProposals);
  const generateNodeGraphProposal = useStudioStore((s) => s.generateNodeGraphProposal);
  const consoleEvents = useStudioStore((s) => s.consoleEvents);
  const nodeResultHistory = useStudioStore((s) => s.nodeResultHistory);
  const restoreNodeResultHistoryEntry = useStudioStore((s) => s.restoreNodeResultHistoryEntry);
  const selectedScopeOutput = selectedScopePromptPreview ? latestScopeOutputs[selectedScopePromptPreview.scope.scopeRef] ?? null : null;
  const [copied, setCopied] = useState(false);
  const [dependencyRecord, setDependencyRecord] = useState<StudioPromptDocumentRecord | null>(null);
  const [dependencyPreviewStatus, setDependencyPreviewStatus] = useState<"idle" | "loading" | "error">("idle");
  const [dependencyPreviewError, setDependencyPreviewError] = useState<string | null>(null);

  const selection = useMemo(
    () =>
      resolveEditorSelection({
        canonicalPrompt,
        nodes,
        selectedNodeId,
        focusedBlockId,
      }),
    [canonicalPrompt, focusedBlockId, nodes, selectedNodeId],
  );
  const runtimeNodeId =
    canonicalPrompt && selection
      ? selection.kind === "prompt"
        ? `prompt_root_${canonicalPrompt.metadata.id}`
        : selection.kind === "block"
          ? selection.block.id
          : null
      : null;
  const runtimeState = runtimeNodeId ? nodeRuntimeStates[runtimeNodeId] ?? null : null;
  const selectedRef = selection && selection.kind !== "use_prompt" ? selection.ref : null;
  const activeDraftSession = selectedRef && activeEditorRef === selectedRef ? editorDrafts[activeEditorRef] ?? null : null;
  const liveCompiled = useMemo(() => {
    if (!activeDraftSession || activeDraftSession.draft.entityKind === "use_prompt") {
      return null;
    }
    return compilePromptWorkspaceBlocks(createPromptWorkspaceBlocks(activeDraftSession.draft));
  }, [activeDraftSession]);
  const activeNodeProposals = useMemo(
    () =>
      runtimeNodeId
        ? Object.values(graphProposals).filter(
            (proposal) => proposal.sourceRuntimeNodeId === runtimeNodeId && proposal.status === "preview",
          )
        : [],
    [graphProposals, runtimeNodeId],
  );
  const recentNodeProposals = useMemo(
    () =>
      runtimeNodeId
        ? Object.values(graphProposals)
            .filter((proposal) => proposal.sourceRuntimeNodeId === runtimeNodeId)
            .sort((left, right) => right.createdAt - left.createdAt)
        : [],
    [graphProposals, runtimeNodeId],
  );
  const latestAppliedNodeProposal = recentNodeProposals.find((proposal) => proposal.status === "applied") ?? null;
  const latestRejectedNodeProposal = recentNodeProposals.find((proposal) => proposal.status === "rejected") ?? null;
  const latestNodeStructureEvent = useMemo(
    () =>
      runtimeNodeId
        ? [...consoleEvents].reverse().find((event) => event.category === "structure" && event.nodeId === runtimeNodeId) ?? null
        : null,
    [consoleEvents, runtimeNodeId],
  );
  const latestNodeStructureError = latestNodeStructureEvent?.status === "error" ? latestNodeStructureEvent : null;
  const currentNodeHistory = runtimeNodeId ? nodeResultHistory[runtimeNodeId] ?? [] : [];
  const dependencyPromptId = selection?.kind === "use_prompt" ? selection.prompt.spec.use[selection.index]?.prompt ?? null : null;
  const dependencyPromptPreview = useMemo(
    () =>
      dependencyRecord
        ? createRenderedPromptPreview(
            dependencyRecord.prompt,
            { mode: "root" },
            `${dependencyRecord.summary.promptId}:${dependencyRecord.summary.updatedAt}`,
          )
        : null,
    [dependencyRecord],
  );
  const promptText =
    selection?.kind === "use_prompt"
      ? dependencyPromptPreview?.renderedText ?? ""
      : selectedScopePromptPreview?.renderedText ?? liveCompiled?.text ?? "";
  const hasPromptPreview =
    selection?.kind === "use_prompt" ? Boolean(dependencyPromptPreview) : Boolean(selectedScopePromptPreview ?? liveCompiled);
  const structureSourceRef = selection && selection.kind !== "use_prompt" ? selection.ref : null;
  const canonicalChildBlocks = useMemo(() => {
    if (!selection || selection.kind === "use_prompt") {
      return [] as PromptBlock[];
    }
    return selection.kind === "prompt" ? selection.prompt.spec.blocks : selection.block.children;
  }, [selection]);

  useEffect(() => {
    let cancelled = false;

    if (selection?.kind !== "use_prompt") {
      setDependencyRecord(null);
      setDependencyPreviewStatus("idle");
      setDependencyPreviewError(null);
      return;
    }

    const promptId = selection.prompt.spec.use[selection.index]?.prompt ?? null;
    if (!promptId) {
      setDependencyRecord(null);
      setDependencyPreviewStatus("error");
      setDependencyPreviewError("Dependency prompt id is missing.");
      return;
    }

    const localRecord = readStudioPromptDocumentFromLocalCacheSnapshot(promptId);
    setDependencyRecord(localRecord);
    setDependencyPreviewStatus(localRecord ? "idle" : "loading");
    setDependencyPreviewError(null);

    void readStudioPromptDocumentFromRemote(promptId)
      .then((record) => {
        if (cancelled) {
          return;
        }
        setDependencyRecord(record);
        if (!record) {
          setDependencyPreviewStatus("error");
          setDependencyPreviewError(`Dependency prompt "${promptId}" could not be loaded.`);
          return;
        }
        setDependencyPreviewStatus("idle");
        setDependencyPreviewError(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setDependencyPreviewStatus("error");
        setDependencyPreviewError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [selection]);

  function handleCopy() {
    if (!promptText) return;
    copyText(promptText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border/70 bg-card/40">
      <Tabs defaultValue="prompt" className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border/70 px-5 py-3">
          <TabsList>
            <TabsTrigger value="prompt">Rendered Prompt</TabsTrigger>
            <TabsTrigger value="rendered">Generation Result</TabsTrigger>
            <TabsTrigger value="structure">Child Nodes</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <TabsContent value="prompt" className="mt-0 flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Compiled Output</div>
              <button type="button" onClick={handleCopy} className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
                {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ScrollArea className="h-full px-5 py-5">
                {hasPromptPreview ? (
                  <div className="space-y-4">
                    {selection?.kind === "use_prompt" && dependencyPromptId ? (
                      <div className="rounded-xl border border-border/70 bg-muted/15 p-4 text-xs text-muted-foreground">
                        <div>Dependency: {dependencyRecord?.summary.title ?? dependencyPromptId}</div>
                        <div>Prompt ID: {dependencyPromptId}</div>
                        <div>Artifact: {dependencyRecord?.summary.artifactType ?? "(unknown)"}</div>
                        <div>Status: {dependencyPreviewStatus === "loading" ? "loading" : dependencyPreviewError ? "error" : "ready"}</div>
                      </div>
                    ) : selectedScopePromptPreview ? (
                      <div className="rounded-xl border border-border/70 bg-muted/15 p-4 text-xs text-muted-foreground">
                        <div>Scope: {selectedScopePromptPreview.scope.label}</div>
                        <div>Inherited messages: {selectedScopePromptPreview.inheritedMessageCount}</div>
                        <div>Selected messages: {selectedScopePromptPreview.selectedMessageCount}</div>
                        <div>Inputs: {selectedScopePromptPreview.inputNames.join(", ") || "(none)"}</div>
                      </div>
                    ) : null}
                    {promptText ? (
                      <pre className="whitespace-pre-wrap text-[15px] leading-9 text-foreground/95">{promptText}</pre>
                    ) : (
                      <div className="flex min-h-[18rem] items-center justify-center text-sm text-muted-foreground">
                        {selection?.kind === "use_prompt" ? "Dependency prompt preview is unavailable." : "Add prompt blocks to inspect the compiled output."}
                      </div>
                    )}
                    {selection?.kind === "use_prompt" && dependencyPreviewError ? (
                      <div className="space-y-2">
                        <p className="text-sm text-destructive">{dependencyPreviewError}</p>
                      </div>
                    ) : null}
                    {selection?.kind === "use_prompt" && dependencyPromptPreview && dependencyPromptPreview.issues.length > 0 ? (
                      <div className="space-y-2">
                        {dependencyPromptPreview.issues.map((issue, index) => (
                          <p key={`${issue.filepath}:${index}`} className="text-sm text-destructive">
                            {issue.message}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    {selection?.kind !== "use_prompt" && selectedScopePromptPreview && selectedScopePromptPreview.issues.length > 0 ? (
                      <div className="space-y-2">
                        {selectedScopePromptPreview.issues.map((issue, index) => (
                          <p key={`${issue.filepath}:${index}`} className="text-sm text-destructive">
                            {issue.message}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex min-h-[18rem] items-center justify-center text-sm text-muted-foreground">
                    {selection?.kind === "use_prompt"
                      ? dependencyPreviewStatus === "loading"
                        ? "Loading dependency prompt..."
                        : "Dependency prompt preview is unavailable."
                      : "Add prompt blocks to inspect the compiled output."}
                  </div>
                )}
              </ScrollArea>
            </div>
          </TabsContent>

          <TabsContent value="rendered" className="mt-0 flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {runtimeState?.status === "running" ? "Generating..." : "Output"}
              </div>
              {selectedScopeOutput ? (
                <div className="flex items-center gap-2">
                  <Badge className="bg-transparent">{selectedScopeOutput.action}</Badge>
                  <Badge className="bg-transparent">{selectedScopeOutput.contentType}</Badge>
                </div>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ScrollArea className="h-full px-5 py-5">
                {selectedScopeOutput ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-border/70 bg-muted/15 p-4 text-xs text-muted-foreground">
                      {selectedScopeOutput.metadata?.provider ? <div>Provider: {String(selectedScopeOutput.metadata.provider)}</div> : null}
                      {selectedScopeOutput.metadata?.model ? <div>Model: {String(selectedScopeOutput.metadata.model)}</div> : null}
                      {selectedScopeOutput.metadata?.executionTimeMs ? <div>Latency: {String(selectedScopeOutput.metadata.executionTimeMs)}ms</div> : null}
                      {selectedScopeOutput.metadata?.executionMode ? <div>Mode: {String(selectedScopeOutput.metadata.executionMode)}</div> : null}
                    </div>
                    <pre className="whitespace-pre-wrap text-[15px] leading-9 text-foreground/95">
                      {typeof selectedScopeOutput.content === "string"
                        ? selectedScopeOutput.content
                        : JSON.stringify(selectedScopeOutput.content, null, 2)}
                    </pre>
                    {selectedScopeOutput.issues.length > 0 ? (
                      <div className="space-y-2">
                        {selectedScopeOutput.issues.map((issue, index) => (
                          <p key={`${issue.filepath}:${index}`} className="text-sm text-destructive">
                            {issue.message}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex min-h-[18rem] items-center justify-center text-sm text-muted-foreground">
                    {selection?.kind === "use_prompt"
                      ? "Use Prompt dependencies are composition inputs. Select the root prompt or a block to generate output."
                      : "Press generate output to create a result for this scope."}
                  </div>
                )}
              </ScrollArea>
            </div>
          </TabsContent>

          <TabsContent value="structure" className="mt-0 flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Child Node Suggestions
              </div>
              <div className="flex items-center gap-2">
                {activeNodeProposals.length > 0 ? <Badge className="bg-transparent">{activeNodeProposals.length} preview</Badge> : null}
                {!activeNodeProposals.length && latestAppliedNodeProposal ? <Badge className="bg-transparent">applied</Badge> : null}
                {latestNodeStructureError ? <Badge className="bg-transparent">error</Badge> : null}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ScrollArea className="h-full px-5 py-5">
                <div className="space-y-4">
                  <div className="rounded-xl border border-border/70 bg-muted/15 p-4 text-xs text-muted-foreground">
                    Review preview child nodes here. Prompt execution stays on the right-side execute flow; structure suggestions stay separate from generated text.
                  </div>

                  {canonicalChildBlocks.length > 0 ? (
                    <div className="rounded-xl border border-border/70 bg-muted/10 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-foreground">Current Child Nodes</div>
                        <Badge className="bg-transparent">
                          {canonicalChildBlocks.length} block{canonicalChildBlocks.length === 1 ? "" : "s"}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        These are the canonical child nodes already attached to the current scope.
                      </div>
                      {renderCanonicalBlockTree({
                        blocks: canonicalChildBlocks,
                        onSelect: (blockId) => focusBlock(blockId),
                      })}
                    </div>
                  ) : null}

                  {latestNodeStructureError ? (
                    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
                      <div className="font-medium text-destructive">Latest child-node suggestion failed</div>
                      <div className="mt-1 text-xs text-muted-foreground">{new Date(latestNodeStructureError.createdAt).toLocaleTimeString()}</div>
                      <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap text-destructive">{latestNodeStructureError.message}</pre>
                    </div>
                  ) : null}

                  {activeNodeProposals.length > 0 ? (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (runtimeNodeId) {
                              applyAllNodeGraphProposals(runtimeNodeId);
                            }
                          }}
                        >
                          Apply Child Nodes
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (runtimeNodeId) {
                              rejectAllNodeGraphProposals(runtimeNodeId);
                            }
                          }}
                        >
                          Reject Child Nodes
                        </Button>
                      </div>

                      {activeNodeProposals.map((proposal) => (
                        <div key={proposal.proposalId} className="rounded-xl border border-border/70 bg-muted/15 p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium text-foreground">{proposal.summary}</div>
                            <Badge className="bg-transparent">preview</Badge>
                            <Badge className="bg-transparent">{proposal.blocks.length} block{proposal.blocks.length === 1 ? "" : "s"}</Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">{new Date(proposal.createdAt).toLocaleTimeString()}</div>
                          {renderProposalBlockTree({
                            blocks: proposal.blocks,
                            onSelect: (proposalNodeId) => {
                              setSelectedProposalNodeId(`proposal:${proposalNodeId}`);
                            },
                          })}
                          {proposal.warnings && proposal.warnings.length > 0 ? (
                            <div className="mt-3 rounded-md border border-amber-300/40 bg-amber-50/40 px-3 py-3 text-xs text-muted-foreground">
                              <div className="font-medium text-foreground">{proposal.warnings.length} warning{proposal.warnings.length === 1 ? "" : "s"}</div>
                              <ul className="mt-1 space-y-1">
                                {proposal.warnings.map((warning, index) => (
                                  <li key={`${proposal.proposalId}:workspace-warning:${index}`}>- {warning}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </>
                  ) : latestAppliedNodeProposal ? (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/5 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium text-foreground">{latestAppliedNodeProposal.summary}</div>
                          <Badge className="bg-transparent">applied</Badge>
                          <Badge className="bg-transparent">
                            {latestAppliedNodeProposal.blocks.length} block{latestAppliedNodeProposal.blocks.length === 1 ? "" : "s"}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Applied to the canonical graph at {new Date(latestAppliedNodeProposal.createdAt).toLocaleTimeString()}.
                        </div>
                        <p className="mt-3 text-sm text-muted-foreground">
                          These child nodes are no longer a preview. They are now part of the graph for this scope.
                        </p>
                        {renderProposalBlockTree({
                          blocks: latestAppliedNodeProposal.blocks,
                          onSelect: (proposalNodeId) => {
                            const canonicalBlockId = findCanonicalBlockIdForAppliedProposal(
                              canonicalPrompt,
                              latestAppliedNodeProposal,
                              proposalNodeId,
                            );
                            if (canonicalBlockId) {
                              focusBlock(canonicalBlockId);
                            }
                          },
                        })}
                        {latestAppliedNodeProposal.warnings && latestAppliedNodeProposal.warnings.length > 0 ? (
                          <div className="mt-3 rounded-md border border-amber-300/40 bg-amber-50/40 px-3 py-3 text-xs text-muted-foreground">
                            <div className="font-medium text-foreground">
                              {latestAppliedNodeProposal.warnings.length} warning{latestAppliedNodeProposal.warnings.length === 1 ? "" : "s"}
                            </div>
                            <ul className="mt-1 space-y-1">
                              {latestAppliedNodeProposal.warnings.map((warning, index) => (
                                <li key={`${latestAppliedNodeProposal.proposalId}:applied-warning:${index}`}>- {warning}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                      {structureSourceRef ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-fit"
                          disabled={runtimeState?.status === "running"}
                          onClick={() => generateNodeGraphProposal(structureSourceRef)}
                        >
                          Regenerate Child Nodes
                        </Button>
                      ) : null}
                    </div>
                  ) : latestRejectedNodeProposal ? (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-border/70 bg-muted/15 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium text-foreground">{latestRejectedNodeProposal.summary}</div>
                          <Badge className="bg-transparent">rejected</Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Latest child-node proposal was rejected at {new Date(latestRejectedNodeProposal.createdAt).toLocaleTimeString()}.
                        </div>
                      </div>
                      {structureSourceRef ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-fit"
                          disabled={runtimeState?.status === "running"}
                          onClick={() => generateNodeGraphProposal(structureSourceRef)}
                        >
                          Suggest Child Nodes
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {canonicalChildBlocks.length === 0 ? (
                        <div className="flex min-h-[12rem] items-center justify-center rounded-xl border border-dashed border-border/70 text-sm text-muted-foreground">
                          No child nodes for this scope yet.
                        </div>
                      ) : (
                        <div className="flex min-h-[8rem] items-center justify-center rounded-xl border border-dashed border-border/70 text-sm text-muted-foreground">
                          No preview child nodes for this scope yet.
                        </div>
                      )}
                      {structureSourceRef ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-fit"
                          disabled={runtimeState?.status === "running"}
                          onClick={() => generateNodeGraphProposal(structureSourceRef)}
                        >
                          Suggest Child Nodes
                        </Button>
                      ) : null}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-0 flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Result History</div>
              {currentNodeHistory.length > 0 ? <Badge className="bg-transparent">{currentNodeHistory.length} entries</Badge> : null}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ScrollArea className="h-full px-5 py-5">
                {currentNodeHistory.length > 0 ? (
                  <div className="space-y-3">
                    {currentNodeHistory.map((entry) => (
                      <div key={entry.historyEntryId} className="rounded-xl border border-border/70 bg-muted/15 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-medium text-foreground">{entry.resultKind}</div>
                            <Badge className="bg-transparent">{new Date(entry.createdAt).toLocaleTimeString()}</Badge>
                            {entry.active ? <Badge className="bg-transparent">active</Badge> : null}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (runtimeNodeId) {
                                restoreNodeResultHistoryEntry(runtimeNodeId, entry.historyEntryId);
                              }
                            }}
                          >
                            Restore
                          </Button>
                        </div>
                        {entry.output.contentType === "graph_proposal" &&
                        Array.isArray((entry.output.content as { warnings?: unknown[] } | null)?.warnings) &&
                        ((entry.output.content as { warnings: unknown[] }).warnings.length > 0) ? (
                          <div className="mt-3 rounded-md border border-amber-300/40 bg-amber-50/40 px-3 py-3 text-xs text-muted-foreground">
                            {((entry.output.content as { warnings: unknown[] }).warnings.length)} warning{((entry.output.content as { warnings: unknown[] }).warnings.length) === 1 ? "" : "s"}
                          </div>
                        ) : null}
                        <pre className="mt-3 whitespace-pre-wrap text-sm leading-7 text-foreground/90">{renderHistoryPreview(entry)}</pre>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[18rem] items-center justify-center text-sm text-muted-foreground">
                    No stored history for this node yet.
                  </div>
                )}
              </ScrollArea>
            </div>
          </TabsContent>
        </div>
      </Tabs>

      <div className="border-t border-border/70 p-4">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            className="ml-auto h-12 min-w-[220px] rounded-xl bg-sky-500 text-[15px] font-semibold text-slate-950 hover:bg-sky-400"
            disabled={!selectedNodeId || selection?.kind === "use_prompt" || runtimeState?.status === "running"}
            onClick={() => runNode(selectedNodeId!)}
          >
            <Sparkles className="h-4 w-4" />
            Generate Output
          </Button>
          {runtimeState?.status === "running" && selection?.kind !== "use_prompt" ? (
            <Button type="button" variant="outline" size="sm" onClick={() => stopNode(selectedNodeId!)} disabled={Boolean(runtimeState.cancelRequestedAt)}>
              {runtimeState.cancelRequestedAt ? "Stopping" : "Stop"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
