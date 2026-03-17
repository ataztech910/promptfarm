import { useMemo, useState, type MouseEvent } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import { Braces, FileText, Plus, Play, X } from "lucide-react";
import type { PromptBlockKind } from "@promptfarm/core";
import type { StudioNodeData } from "../graph/types";
import { getSuggestedBlockKinds } from "../model/promptTree";
import { useStudioStore } from "../state/studioStore";
import { NODE_REGISTRY_MAP } from "./nodeRegistry";

function formatBlockKind(value: string): string {
  return value.replaceAll("_", " ");
}

function statusClassName(status: "idle" | "running" | "success" | "error" | "stale"): string {
  if (status === "success") return "border-emerald-300/80 bg-emerald-100 text-emerald-900";
  if (status === "error") return "border-red-300/80 bg-red-100 text-red-900";
  if (status === "running") return "border-sky-300/80 bg-sky-100 text-sky-900";
  if (status === "stale") return "border-amber-300/80 bg-amber-100 text-amber-900";
  return "border-border bg-background/95 text-muted-foreground";
}

export function StudioGraphNode({ id, data, selected }: NodeProps) {
  const node = data as StudioNodeData;
  const isProposalNode = node.graphState === "proposal";
  const registryItem = NODE_REGISTRY_MAP.get(node.kind);
  const Icon = registryItem?.icon;
  const canonicalPrompt = useStudioStore((s) => s.canonicalPrompt);
  const applyGraphIntent = useStudioStore((s) => s.applyGraphIntent);
  const setSelectedNodeId = useStudioStore((s) => s.setSelectedNodeId);
  const selectedNodeId = useStudioStore((s) => s.selectedNodeId);
  const nodeRuntimeStates = useStudioStore((s) => s.nodeRuntimeStates);
  const latestScopeOutputs = useStudioStore((s) => s.latestScopeOutputs);
  const nodeExecutionRecords = useStudioStore((s) => s.nodeExecutionRecords);
  const runNode = useStudioStore((s) => s.runNode);
  const generateNodeGraphProposal = useStudioStore((s) => s.generateNodeGraphProposal);
  const stopNode = useStudioStore((s) => s.stopNode);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const isSelected = selectedNodeId === id || selected;

  const quickAddKinds = useMemo(() => {
    if (isProposalNode) return [];
    if (!canonicalPrompt) return [];
    if (node.kind === "prompt") {
      return getSuggestedBlockKinds(canonicalPrompt, null).slice(0, 3);
    }
    if (node.kind !== "block") return [];
    const blockId = node.properties.__blockId ?? node.properties.blockId;
    if (!blockId) return [];
    return getSuggestedBlockKinds(canonicalPrompt, blockId).slice(0, 3);
  }, [canonicalPrompt, isProposalNode, node.kind, node.properties.__blockId, node.properties.blockId]);

  const runtimeState = useMemo(() => {
    if (isProposalNode) {
      return null;
    }

    if (node.kind === "prompt") {
      const promptId = node.properties.id;
      return promptId ? nodeRuntimeStates[`prompt_root_${promptId}`] ?? null : null;
    }

    if (node.kind !== "block") {
      return null;
    }

    const blockId = node.properties.__blockId ?? node.properties.blockId;
    return blockId ? nodeRuntimeStates[blockId] ?? null : null;
  }, [isProposalNode, node.kind, node.properties.__blockId, node.properties.blockId, node.properties.id, nodeRuntimeStates]);
  const runtimeLabel = runtimeState?.status === "running" && runtimeState.cancelRequestedAt ? "stopping" : runtimeState?.status;
  const latestExecutionRecord = useMemo(() => {
    if (!runtimeState?.lastExecutionId) {
      return null;
    }
    return nodeExecutionRecords[runtimeState.lastExecutionId] ?? null;
  }, [nodeExecutionRecords, runtimeState?.lastExecutionId]);
  const latestExecutionKind = useMemo(() => {
    if (isProposalNode) {
      return null;
    }

    const scopeRef =
      node.kind === "prompt"
        ? node.properties.id
          ? `root:${node.properties.id}`
          : null
        : node.kind === "block"
          ? (node.properties.__blockId ?? node.properties.blockId)
            ? `block:${node.properties.__blockId ?? node.properties.blockId}`
            : null
          : null;
    if (!scopeRef) {
      return null;
    }

    const latestOutput = latestScopeOutputs[scopeRef];
    if (latestOutput?.contentType === "graph_proposal") {
      return "structure" as const;
    }
    if (latestOutput?.contentType === "generated_output") {
      return "text" as const;
    }
    return null;
  }, [isProposalNode, latestScopeOutputs, node.kind, node.properties.__blockId, node.properties.blockId, node.properties.id]);

  const primaryRunMode =
    latestExecutionRecord?.mode === "structure" && runtimeState?.status !== "running"
      ? "structure"
      : latestExecutionKind === "structure"
        ? "structure"
        : "text";

  function handleQuickAdd(kind: PromptBlockKind, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const blockId = node.kind === "block" ? node.properties.__blockId ?? node.properties.blockId : null;
    applyGraphIntent({ type: "block.add", kind, parentBlockId: blockId });
    setSelectedNodeId(id);
    setQuickActionsOpen(false);
  }

  return (
    <div
      className={`group relative min-w-[190px] rounded-md border bg-card/95 px-3 py-2 shadow-xl transition ${
        isProposalNode
          ? "border-amber-400/80 bg-amber-50/95"
          : isSelected
            ? "border-primary/70 ring-1 ring-primary/50"
            : "border-border"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-border" />

      {runtimeState ? (
        <div className="absolute -top-3 right-0 z-20 flex translate-y-[-100%] items-center gap-1">
          <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide shadow-sm ${statusClassName(runtimeState.status)}`}>
            {runtimeLabel}
          </span>
          {runtimeState.status === "running" ? (
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-red-300/80 bg-red-100 text-red-900 shadow transition hover:bg-red-200"
              onClick={(event) => {
                event.stopPropagation();
                stopNode(id);
              }}
              title={runtimeState.cancelRequestedAt ? "Stop requested" : "Stop execution"}
              disabled={Boolean(runtimeState.cancelRequestedAt)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-300/80 bg-emerald-100 text-emerald-900 shadow transition hover:bg-emerald-200"
              onClick={(event) => {
                event.stopPropagation();
                if (primaryRunMode === "structure") {
                  generateNodeGraphProposal(id);
                  return;
                }
                runNode(id);
              }}
              title={
                primaryRunMode === "structure"
                  ? node.kind === "prompt"
                    ? "Retry root structure generation"
                    : "Retry structure generation"
                  : node.kind === "prompt"
                    ? "Run root node"
                    : "Run node"
              }
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          {(node.kind === "block" || node.kind === "prompt") && quickAddKinds.length > 0 ? (
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/95 text-muted-foreground shadow transition hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                setQuickActionsOpen((open) => !open);
              }}
              title="Add child block"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}

      {isProposalNode ? (
        <div className="absolute -top-3 right-0 z-20 flex translate-y-[-100%] items-center gap-1">
          <span className="rounded-full border border-amber-300/80 bg-amber-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-900 shadow-sm">
            Proposed
          </span>
        </div>
      ) : null}

      {quickActionsOpen && (node.kind === "block" || node.kind === "prompt") && quickAddKinds.length > 0 ? (
        <div className="absolute -top-2 right-0 z-20 flex min-w-[160px] translate-y-[-100%] flex-col rounded-md border border-border bg-card p-1 shadow-2xl">
          {quickAddKinds.map((kind) => (
            <button
              key={`${id}:${kind}`}
              type="button"
              className="rounded px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted"
              onClick={(event) => handleQuickAdd(kind, event)}
            >
              {node.kind === "prompt" ? `Add ${formatBlockKind(kind)}` : `Add child ${formatBlockKind(kind)}`}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mb-1 flex items-center gap-2">
        {Icon ? <Icon className={`h-3.5 w-3.5 ${registryItem?.accent ?? "text-muted-foreground"}`} /> : null}
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{registryItem?.title ?? node.kind}</p>
      </div>
      <p className="text-sm font-medium text-foreground">{node.title}</p>
      <p className="line-clamp-2 text-xs text-muted-foreground">{node.description}</p>
      {latestExecutionKind ? (
        <div className="mt-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              latestExecutionKind === "text"
                ? "border-emerald-300/70 bg-emerald-50/60 text-emerald-900"
                : "border-amber-300/70 bg-amber-50/60 text-amber-900"
            }`}
          >
            {latestExecutionKind === "text" ? <FileText className="h-3 w-3" /> : <Braces className="h-3 w-3" />}
            {latestExecutionKind}
          </span>
        </div>
      ) : null}
      {isProposalNode ? (
        <p className="mt-2 text-[11px] font-medium text-amber-900/80">{node.properties.blockKind.replaceAll("_", " ")}</p>
      ) : null}

      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-border" />
    </div>
  );
}
