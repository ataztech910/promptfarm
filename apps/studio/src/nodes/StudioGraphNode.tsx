import { useMemo, useState, type MouseEvent } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import { Plus } from "lucide-react";
import { useStudioStore } from "../state/studioStore";
import { getSuggestedBlockKinds } from "../model/promptTree";
import type { PromptBlockKind } from "@promptfarm/core";
import type { StudioNodeData } from "../graph/types";
import { NODE_REGISTRY_MAP } from "./nodeRegistry";

function formatBlockKind(value: string): string {
  return value.replaceAll("_", " ");
}

export function StudioGraphNode({ id, data, selected }: NodeProps) {
  const node = data as StudioNodeData;
  const registryItem = NODE_REGISTRY_MAP.get(node.kind);
  const Icon = registryItem?.icon;
  const canonicalPrompt = useStudioStore((s) => s.canonicalPrompt);
  const applyGraphIntent = useStudioStore((s) => s.applyGraphIntent);
  const setSelectedNodeId = useStudioStore((s) => s.setSelectedNodeId);
  const selectedNodeId = useStudioStore((s) => s.selectedNodeId);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const isSelected = selectedNodeId === id || selected;

  const quickAddKinds = useMemo(() => {
    if (node.kind !== "block" || !canonicalPrompt) return [];
    const blockId = node.properties.__blockId ?? node.properties.blockId;
    if (!blockId) return [];
    return getSuggestedBlockKinds(canonicalPrompt, blockId).slice(0, 3);
  }, [canonicalPrompt, node.kind, node.properties.__blockId, node.properties.blockId]);

  function handleQuickAdd(kind: PromptBlockKind, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const blockId = node.properties.__blockId ?? node.properties.blockId;
    if (!blockId) return;
    applyGraphIntent({ type: "block.add", kind, parentBlockId: blockId });
    setSelectedNodeId(id);
    setQuickActionsOpen(false);
  }

  return (
    <div
      className={`group relative min-w-[190px] rounded-md border bg-card/95 px-3 py-2 shadow-xl transition ${
        isSelected ? "border-primary/70 ring-1 ring-primary/50" : "border-border"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-border" />

      {node.kind === "block" && quickAddKinds.length > 0 ? (
        <div className="absolute top-2 right-2 z-10">
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/95 text-muted-foreground opacity-90 shadow transition hover:text-foreground hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              setQuickActionsOpen((open) => !open);
            }}
            title="Add child block"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>

          {quickActionsOpen ? (
            <div className="absolute top-9 right-0 flex min-w-[160px] flex-col rounded-md border border-border bg-card p-1 shadow-2xl">
              {quickAddKinds.map((kind) => (
                <button
                  key={`${id}:${kind}`}
                  type="button"
                  className="rounded px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted"
                  onClick={(event) => handleQuickAdd(kind, event)}
                >
                  Add child {formatBlockKind(kind)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mb-1 flex items-center gap-2">
        {Icon ? <Icon className={`h-3.5 w-3.5 ${registryItem?.accent ?? "text-muted-foreground"}`} /> : null}
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{registryItem?.title ?? node.kind}</p>
      </div>
      <p className="pr-8 text-sm font-medium text-foreground">{node.title}</p>
      <p className="line-clamp-2 text-xs text-muted-foreground">{node.description}</p>

      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-border" />
    </div>
  );
}
