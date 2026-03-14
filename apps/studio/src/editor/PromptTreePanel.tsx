import { ChevronDown, ChevronRight, ChevronUp, FolderTree, Plus, Trash2 } from "lucide-react";
import { getAllowedPromptBlockKinds, type PromptBlock } from "@promptfarm/core";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { describeTreeEmptyState, findPromptBlockReference, getPromptBlockPath, getSiblingBlockKinds, getSuggestedBlockKinds } from "../model/promptTree";
import { useStudioStore } from "../state/studioStore";

function formatBlockKind(value: string): string {
  return value.replaceAll("_", " ");
}

function TreeRow({
  block,
  depth,
  pathIds,
  onSelectBlock,
}: {
  block: PromptBlock;
  depth: number;
  pathIds: Set<string>;
  onSelectBlock?: (blockId: string) => void;
}) {
  const focusedBlockId = useStudioStore((s) => s.focusedBlockId);
  const focusBlock = useStudioStore((s) => s.focusBlock);
  const applyGraphIntent = useStudioStore((s) => s.applyGraphIntent);
  const canonicalPrompt = useStudioStore((s) => s.canonicalPrompt);
  const collapsedBlockIds = useStudioStore((s) => s.collapsedBlockIds);
  const toggleBlockCollapsed = useStudioStore((s) => s.toggleBlockCollapsed);

  if (!canonicalPrompt) return null;

  const active = focusedBlockId === block.id;
  const inFocusedPath = pathIds.has(block.id);
  const isCollapsed = collapsedBlockIds.includes(block.id);
  const childKinds = getSuggestedBlockKinds(canonicalPrompt, block.id);
  const siblingKinds = getSiblingBlockKinds(canonicalPrompt, block.id);
  const parentId = findPromptBlockReference(canonicalPrompt.spec.blocks, block.id)?.parentId ?? null;
  const canHaveChildren = getAllowedPromptBlockKinds(canonicalPrompt.spec.artifact.type, block.kind).length > 0;

  return (
    <div className="space-y-1">
      <div
        className={`rounded-md border px-2 py-1.5 ${
          active ? "border-primary/60 bg-primary/10" : inFocusedPath ? "border-border bg-muted/20" : "border-transparent"
        }`}
        style={{ marginLeft: `${depth * 16}px` }}
      >
        <div className="flex items-start gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="mt-0.5 h-6 w-6 shrink-0"
            onClick={() => toggleBlockCollapsed(block.id)}
          >
            {block.children.length > 0 ? (
              isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <FolderTree className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </Button>

          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => {
              focusBlock(block.id);
              onSelectBlock?.(block.id);
            }}
          >
            <div className="text-xs font-semibold text-foreground">{block.title}</div>
            <div className="text-[11px] text-muted-foreground">
              {canHaveChildren
                ? `${formatBlockKind(block.kind)} • ${block.children.length} child${block.children.length === 1 ? "" : "ren"}`
                : formatBlockKind(block.kind)}
            </div>
          </button>

          <div className="flex items-center gap-1">
            {childKinds.slice(0, 1).map((kind) => (
              <Button
                key={`${block.id}:child:${kind}`}
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => applyGraphIntent({ type: "block.add", kind, parentBlockId: block.id })}
                title={`Add ${formatBlockKind(kind)} child`}
              >
                <Plus className="h-3.5 w-3.5" />
                Child
              </Button>
            ))}
            {siblingKinds.slice(0, 1).map((kind) => (
              <Button
                key={`${block.id}:sibling:${kind}`}
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => applyGraphIntent({ type: "block.add", kind, parentBlockId: parentId })}
                title={`Add ${formatBlockKind(kind)} sibling`}
              >
                <Plus className="h-3.5 w-3.5" />
                Sibling
              </Button>
            ))}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => applyGraphIntent({ type: "block.move", blockId: block.id, direction: "up" })}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive"
              onClick={() => applyGraphIntent({ type: "block.remove", blockId: block.id })}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {!isCollapsed
        ? block.children.map((child) => (
            <TreeRow key={child.id} block={child} depth={depth + 1} pathIds={pathIds} onSelectBlock={onSelectBlock} />
          ))
        : null}
    </div>
  );
}

type PromptTreePanelProps = {
  onSelectRoot?: () => void;
  onSelectBlock?: (blockId: string) => void;
};

export function PromptTreePanel({ onSelectRoot, onSelectBlock }: PromptTreePanelProps) {
  const canonicalPrompt = useStudioStore((s) => s.canonicalPrompt);
  const focusedBlockId = useStudioStore((s) => s.focusedBlockId);
  const focusBlock = useStudioStore((s) => s.focusBlock);
  const applyGraphIntent = useStudioStore((s) => s.applyGraphIntent);

  if (!canonicalPrompt) {
    return null;
  }

  const suggestedKinds = getSuggestedBlockKinds(canonicalPrompt, focusedBlockId);
  const path = focusedBlockId ? getPromptBlockPath(canonicalPrompt.spec.blocks, focusedBlockId) : [];
  const pathIds = new Set(path.map((block) => block.id));
  const emptyState = describeTreeEmptyState(canonicalPrompt);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Prompt Tree</h2>
        <p className="mt-1 text-xs text-muted-foreground">Hierarchical prompt units optimized for books, courses, and structured instructions.</p>
      </div>

      <div className="border-b border-border px-2 py-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Button
            variant={focusedBlockId ? "ghost" : "secondary"}
            size="sm"
            className="justify-start"
            onClick={() => {
              focusBlock(null);
              onSelectRoot?.();
            }}
          >
            <FolderTree className="h-3.5 w-3.5" />
            Root Prompt
          </Button>
          <span className="max-w-[200px] truncate text-[11px] text-muted-foreground">
            {path.length > 0 ? path.map((block) => block.title).join(" / ") : "Top-level blocks"}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {suggestedKinds.map((kind) => (
            <Button
              key={kind}
              variant="outline"
              size="sm"
              onClick={() => applyGraphIntent({ type: "block.add", kind, parentBlockId: focusedBlockId })}
            >
              <Plus className="h-3.5 w-3.5" />
              {focusedBlockId ? `Add child ${formatBlockKind(kind)}` : `Add ${formatBlockKind(kind)}`}
            </Button>
          ))}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 p-2">
        {canonicalPrompt.spec.blocks.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-3">
            <p className="text-xs font-semibold text-foreground">Structured authoring starts here</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{emptyState}</p>
          </div>
        ) : (
          <div className="space-y-1">
            {canonicalPrompt.spec.blocks.map((block) => (
              <TreeRow key={block.id} block={block} depth={0} pathIds={pathIds} onSelectBlock={onSelectBlock} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
