import { useEffect, useMemo, useRef, useState } from "react";
import { closestCenter, DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, Eye, EyeOff, FileText, FolderTree, GitBranchPlus, GripVertical, Link2, Plus, Trash2, type LucideIcon } from "lucide-react";
import type { Prompt, PromptBlock, PromptBlockKind } from "@promptfarm/core";
import { getAllowedPromptBlockKinds } from "@promptfarm/core";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { ScrollArea } from "../components/ui/scroll-area";
import { cn } from "../lib/cn";
import {
  describeTreeEmptyState,
  findPromptBlockById,
  getPromptBlockPath,
  getSiblingBlockKinds,
  getSuggestedBlockKinds,
} from "../model/promptTree";
import { listStudioPromptDocumentsFromRemote, type StudioPromptDocumentSummary } from "../runtime/studioPromptDocumentRemote";
import { useStudioStore } from "../state/studioStore";
import { ConfirmDialog } from "./ConfirmDialog";
import { toast } from "sonner";

type VisibleTreeNode = {
  id: string;
  block: PromptBlock;
  depth: number;
  parentId: string | null;
  childKind: PromptBlockKind | null;
  siblingKind: PromptBlockKind | null;
  isExpanded: boolean;
  isHidden: boolean;
};

type PendingMove = {
  activeId: string;
  overId: string;
  targetParentId: string | null;
  targetIndex: number;
};

type VisibleDependencyNode = {
  promptId: string;
  title: string;
  artifactType: Prompt["spec"]["artifact"]["type"] | null;
  isHidden: boolean;
  mode: string;
};

function formatBlockKind(value: string): string {
  return value.replaceAll("_", " ");
}

function formatBlockMeta(block: PromptBlock, childKind: PromptBlockKind | null, artifactType: Prompt["spec"]["artifact"]["type"]): string {
  const canHaveChildren = childKind !== null || getAllowedPromptBlockKinds(artifactType, block.kind).length > 0;
  return canHaveChildren
    ? `${formatBlockKind(block.kind)} • ${block.children.length} child${block.children.length === 1 ? "" : "ren"}`
    : formatBlockKind(block.kind);
}

function collectVisibleTreeNodes(
  prompt: Prompt,
  blocks: PromptBlock[],
  collapsedBlockIds: Set<string>,
  hiddenBlockIds: Set<string>,
  depth = 0,
  parentId: string | null = null,
  hiddenByAncestor = false,
): VisibleTreeNode[] {
  return blocks.flatMap((block) => {
    const childKind = getSuggestedBlockKinds(prompt, block.id)[0] ?? null;
    const siblingKind = getSiblingBlockKinds(prompt, block.id)[0] ?? null;
    const isHidden = hiddenByAncestor || hiddenBlockIds.has(block.id);
    const node: VisibleTreeNode = {
      id: block.id,
      block,
      depth,
      parentId,
      childKind,
      siblingKind,
      isExpanded: !collapsedBlockIds.has(block.id),
      isHidden,
    };

    return collapsedBlockIds.has(block.id)
      ? [node]
      : [node, ...collectVisibleTreeNodes(prompt, block.children, collapsedBlockIds, hiddenBlockIds, depth + 1, block.id, isHidden)];
  });
}

function ActionButton({
  icon: Icon,
  onClick,
  label,
  danger = false,
}: {
  icon: LucideIcon;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "rounded-md p-1 text-muted-foreground transition-all",
        danger ? "hover:bg-destructive/20 hover:text-destructive" : "hover:bg-primary/15 hover:text-primary",
      )}
      title={label}
    >
      <Icon size={13} />
    </button>
  );
}

function DependencyMenuButton({
  attachedPromptIds,
  availablePrompts,
  promptsStatus,
  onCheckedChange,
}: {
  attachedPromptIds: Set<string>;
  availablePrompts: StudioPromptDocumentSummary[];
  promptsStatus: "idle" | "loading" | "failure";
  onCheckedChange: (promptId: string, nextChecked: boolean) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground transition-all hover:bg-primary/15 hover:text-primary"
          title="Manage prompt dependencies"
          onClick={(event) => event.stopPropagation()}
        >
          <Link2 size={13} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuLabel>Prompt Dependencies</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {promptsStatus === "loading" ? <div className="px-2 py-1.5 text-sm text-muted-foreground">Loading prompts...</div> : null}
        {promptsStatus === "failure" ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">Could not load prompts from the current workspace.</div>
        ) : null}
        {promptsStatus !== "loading" && availablePrompts.length === 0 ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">No other prompts available in this workspace yet.</div>
        ) : null}
        {availablePrompts.map((prompt) => (
          <DropdownMenuCheckboxItem
            key={prompt.promptId}
            checked={attachedPromptIds.has(prompt.promptId)}
            onCheckedChange={(checked) => onCheckedChange(prompt.promptId, checked === true)}
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{prompt.title}</span>
              <span className="truncate text-[11px] text-muted-foreground">
                {prompt.promptId} • {formatBlockKind(prompt.artifactType)}
              </span>
            </div>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TreeNodeRow({
  node,
  artifactType,
  isSelected,
  onSelect,
  onToggleExpand,
  onAddChild,
  onAddSibling,
  onToggleHidden,
  onDelete,
}: {
  node: VisibleTreeNode;
  artifactType: Prompt["spec"]["artifact"]["type"];
  isSelected: boolean;
  onSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onAddChild: (id: string, kind: PromptBlockKind) => void;
  onAddSibling: (parentId: string | null, kind: PromptBlockKind) => void;
  onToggleHidden: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const hasChildren = node.block.children.length > 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex h-8 w-full cursor-pointer items-center rounded-md transition-all duration-200",
        isDragging ? "z-50 opacity-40" : "opacity-100",
        node.isHidden ? "opacity-45" : "",
        isSelected ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      )}
      onClick={() => onSelect(node.id)}
    >
      <div style={{ width: `${node.depth * 16 + 4}px` }} className="shrink-0" />

      <div
        {...attributes}
        {...listeners}
        className="shrink-0 px-0.5 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(event) => event.stopPropagation()}
      >
        <GripVertical size={12} className="cursor-grab text-muted-foreground active:cursor-grabbing" />
      </div>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (hasChildren) {
            onToggleExpand(node.id);
          }
        }}
        className={cn(
          "shrink-0 p-0.5 transition-transform duration-200",
          hasChildren ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <ChevronRight size={14} className={cn("transition-transform duration-200", node.isExpanded ? "rotate-90" : "")} />
      </button>

      <div className="ml-1 flex min-w-0 flex-1 items-center gap-1.5">
        <FileText size={13} className={cn("shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-foreground">{node.block.title}</div>
          <div className="truncate text-[11px] text-muted-foreground">{formatBlockMeta(node.block, node.childKind, artifactType)}</div>
        </div>
      </div>

      <div className="shrink-0 pr-2 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="flex items-center gap-0.5">
          {node.childKind ? (
            <ActionButton icon={Plus} label="Add child" onClick={() => onAddChild(node.id, node.childKind!)} />
          ) : null}
          {node.siblingKind ? (
            <ActionButton icon={GitBranchPlus} label="Add sibling" onClick={() => onAddSibling(node.parentId, node.siblingKind!)} />
          ) : null}
          <ActionButton
            icon={node.isHidden ? EyeOff : Eye}
            label={node.isHidden ? "Show branch in root prompt" : "Hide branch from root prompt"}
            onClick={() => onToggleHidden(node.id)}
          />
          <ActionButton icon={Trash2} label="Delete" danger onClick={() => onDelete(node.id)} />
        </div>
      </div>
    </div>
  );
}

function DependencyRow({
  node,
  isSelected,
  onSelect,
  onToggleHidden,
  onDetach,
}: {
  node: VisibleDependencyNode;
  isSelected: boolean;
  onSelect: (promptId: string) => void;
  onToggleHidden: (promptId: string) => void;
  onDetach: (promptId: string) => void;
}) {
  return (
    <div
      className={cn(
        "group relative flex h-8 w-full cursor-pointer items-center rounded-md transition-all duration-200",
        node.isHidden ? "opacity-45" : "",
        isSelected ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      )}
      onClick={() => onSelect(node.promptId)}
    >
      <div style={{ width: `${16 + 4}px` }} className="shrink-0" />
      <div className="shrink-0 px-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="h-3 w-3" />
      </div>
      <div className="shrink-0 p-0.5 opacity-0">
        <div className="h-[14px] w-[14px]" />
      </div>
      <div className="ml-1 flex min-w-0 flex-1 items-center gap-1.5">
        <Link2 size={13} className={cn("shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-foreground">{node.title}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            dependency • {node.artifactType ? formatBlockKind(node.artifactType) : "unknown"} • {node.mode}
          </div>
        </div>
      </div>
      <div className="shrink-0 pr-2 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="flex items-center gap-0.5">
          <ActionButton
            icon={node.isHidden ? EyeOff : Eye}
            label={node.isHidden ? "Show dependency in root prompt" : "Hide dependency from root prompt"}
            onClick={() => onToggleHidden(node.promptId)}
          />
          <ActionButton icon={Trash2} label="Detach dependency" danger onClick={() => onDetach(node.promptId)} />
        </div>
      </div>
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
  const selectedNodeId = useStudioStore((s) => s.selectedNodeId);
  const currentProjectId = useStudioStore((s) => s.currentProjectId);
  const collapsedBlockIds = useStudioStore((s) => s.collapsedBlockIds);
  const hiddenBlockIds = useStudioStore((s) => s.hiddenBlockIds);
  const hiddenDependencyPromptIds = useStudioStore((s) => s.hiddenDependencyPromptIds);
  const syncIssues = useStudioStore((s) => s.syncIssues);
  const focusBlock = useStudioStore((s) => s.focusBlock);
  const setSelectedNodeId = useStudioStore((s) => s.setSelectedNodeId);
  const toggleBlockCollapsed = useStudioStore((s) => s.toggleBlockCollapsed);
  const toggleBlockHidden = useStudioStore((s) => s.toggleBlockHidden);
  const toggleDependencyHidden = useStudioStore((s) => s.toggleDependencyHidden);
  const attachPromptDependency = useStudioStore((s) => s.attachPromptDependency);
  const detachPromptDependency = useStudioStore((s) => s.detachPromptDependency);
  const applyGraphIntent = useStudioStore((s) => s.applyGraphIntent);
  const clearSyncIssues = useStudioStore((s) => s.clearSyncIssues);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingDetachDependency, setPendingDetachDependency] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [availablePrompts, setAvailablePrompts] = useState<StudioPromptDocumentSummary[]>([]);
  const [promptsStatus, setPromptsStatus] = useState<"idle" | "loading" | "failure">("idle");
  const lastSyncIssueRef = useRef<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const collapsedSet = useMemo(() => new Set(collapsedBlockIds), [collapsedBlockIds]);
  const hiddenSet = useMemo(() => new Set(hiddenBlockIds), [hiddenBlockIds]);
  const hiddenDependencySet = useMemo(() => new Set(hiddenDependencyPromptIds), [hiddenDependencyPromptIds]);
  const attachedDependencyPromptIds = useMemo(
    () => new Set(canonicalPrompt?.spec.use.map((dep) => dep.prompt) ?? []),
    [canonicalPrompt],
  );

  const visibleNodes = useMemo(() => {
    if (!canonicalPrompt) {
      return [];
    }
    return collectVisibleTreeNodes(canonicalPrompt, canonicalPrompt.spec.blocks, collapsedSet, hiddenSet);
  }, [canonicalPrompt, collapsedSet, hiddenSet]);

  const visibleDependencies = useMemo<VisibleDependencyNode[]>(() => {
    if (!canonicalPrompt) {
      return [];
    }

    const summariesByPromptId = new Map(availablePrompts.map((prompt) => [prompt.promptId, prompt]));
    return canonicalPrompt.spec.use.map((dep) => {
      const summary = summariesByPromptId.get(dep.prompt);
      return {
        promptId: dep.prompt,
        title: summary?.title ?? dep.prompt,
        artifactType: summary?.artifactType ?? null,
        isHidden: hiddenDependencySet.has(dep.prompt),
        mode: dep.mode ?? "inline",
      };
    });
  }, [availablePrompts, canonicalPrompt, hiddenDependencySet]);

  useEffect(() => {
    let cancelled = false;
    if (!canonicalPrompt) {
      setAvailablePrompts([]);
      setPromptsStatus("idle");
      return;
    }

    setPromptsStatus("loading");
    void listStudioPromptDocumentsFromRemote(currentProjectId ? { projectId: currentProjectId } : undefined)
      .then((prompts) => {
        if (cancelled) {
          return;
        }
        setAvailablePrompts(prompts.filter((prompt) => prompt.promptId !== canonicalPrompt.metadata.id));
        setPromptsStatus("idle");
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setAvailablePrompts([]);
        setPromptsStatus("failure");
      });

    return () => {
      cancelled = true;
    };
  }, [canonicalPrompt, currentProjectId]);

  useEffect(() => {
    const issue = syncIssues[0] ?? null;
    if (!issue || issue === lastSyncIssueRef.current) {
      return;
    }
    lastSyncIssueRef.current = issue;
    toast.error("Operation unavailable", {
      description: issue,
    });
    clearSyncIssues();
  }, [clearSyncIssues, syncIssues]);

  if (!canonicalPrompt) {
    return null;
  }

  const rootSuggestedKinds = getSuggestedBlockKinds(canonicalPrompt, null);
  const rootKind = rootSuggestedKinds[0] ?? null;
  const path = focusedBlockId ? getPromptBlockPath(canonicalPrompt.spec.blocks, focusedBlockId) : [];
  const emptyState = describeTreeEmptyState(canonicalPrompt);
  const activeNode = activeId ? findPromptBlockById(canonicalPrompt.spec.blocks, activeId) : null;
  const moveNodeData = pendingMove ? findPromptBlockById(canonicalPrompt.spec.blocks, pendingMove.activeId) : null;
  const moveTargetData = pendingMove ? findPromptBlockById(canonicalPrompt.spec.blocks, pendingMove.overId) : null;
  const deleteNodeData = pendingDelete ? findPromptBlockById(canonicalPrompt.spec.blocks, pendingDelete) : null;
  const rootSelectionId = `prompt:${canonicalPrompt.metadata.id}`;

  function handleSelect(id: string) {
    focusBlock(id);
    onSelectBlock?.(id);
  }

  function handleSelectDependency(promptId: string) {
    focusBlock(null);
    setSelectedNodeId(`use_prompt:${promptId}`);
  }

  function handleAddChild(id: string, kind: PromptBlockKind) {
    applyGraphIntent({ type: "block.add", kind, parentBlockId: id });
  }

  function handleAddSibling(parentId: string | null, kind: PromptBlockKind) {
    applyGraphIntent({ type: "block.add", kind, parentBlockId: parentId });
  }

  function handleAddRoot() {
    if (!rootKind) {
      return;
    }
    applyGraphIntent({ type: "block.add", kind: rootKind, parentBlockId: null });
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const activeBlockId = String(event.active.id);
    const overBlockId = event.over ? String(event.over.id) : null;
    if (!overBlockId || activeBlockId === overBlockId) {
      return;
    }
    const overNode = visibleNodes.find((node) => node.id === overBlockId);
    if (!overNode) {
      return;
    }

    const siblingList = overNode.parentId ? findPromptBlockById(canonicalPrompt.spec.blocks, overNode.parentId)?.children : canonicalPrompt.spec.blocks;
    if (!siblingList) {
      return;
    }

    const targetIndex = siblingList.findIndex((block) => block.id === overBlockId);
    if (targetIndex < 0) {
      return;
    }

    setPendingMove({
      activeId: activeBlockId,
      overId: overBlockId,
      targetParentId: overNode.parentId,
      targetIndex,
    });
  }

  function confirmMove() {
    if (!pendingMove) {
      return;
    }
    applyGraphIntent({
      type: "block.relocate",
      blockId: pendingMove.activeId,
      targetParentId: pendingMove.targetParentId,
      targetIndex: pendingMove.targetIndex,
    });
    setPendingMove(null);
  }

  function confirmDelete() {
    if (!pendingDelete) {
      return;
    }
    applyGraphIntent({ type: "block.remove", blockId: pendingDelete });
    setPendingDelete(null);
  }

  function confirmDetachDependency() {
    if (!pendingDetachDependency) {
      return;
    }
    detachPromptDependency(pendingDetachDependency);
    setPendingDetachDependency(null);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1 px-2 py-2">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div className="space-y-px">
            <div
              className={cn(
                "group relative flex h-8 w-full cursor-pointer items-center rounded-md transition-all duration-200",
                selectedNodeId === rootSelectionId ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              )}
              onClick={() => {
                focusBlock(null);
                onSelectRoot?.();
              }}
            >
              <div className="shrink-0 pl-1" />
              <div className="shrink-0 px-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <div className="h-3 w-3" />
              </div>
              <div className="shrink-0 p-0.5 opacity-0">
                <div className="h-[14px] w-[14px]" />
              </div>
              <div className="ml-1 flex min-w-0 flex-1 items-center gap-1.5">
                <FolderTree size={13} className={cn("shrink-0", focusedBlockId === null ? "text-primary" : "text-muted-foreground")} />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-foreground">Root Prompt</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {path.length > 0 ? path.map((block) => block.title).join(" / ") : "Top-level blocks"}
                  </div>
                </div>
              </div>
              <div className="shrink-0 pr-2 opacity-0 transition-opacity group-hover:opacity-100">
                <div className="flex items-center gap-0.5">
                  <DependencyMenuButton
                    attachedPromptIds={attachedDependencyPromptIds}
                    availablePrompts={availablePrompts}
                    promptsStatus={promptsStatus}
                    onCheckedChange={(promptId, nextChecked) => {
                      if (nextChecked) {
                        attachPromptDependency(promptId);
                        return;
                      }
                      detachPromptDependency(promptId);
                    }}
                  />
                  {rootKind ? (
                    <ActionButton icon={Plus} label={`Add ${formatBlockKind(rootKind)}`} onClick={handleAddRoot} />
                  ) : null}
                </div>
              </div>
            </div>

            {visibleDependencies.map((dependency) => (
              <DependencyRow
                key={dependency.promptId}
                node={dependency}
                isSelected={selectedNodeId === `use_prompt:${dependency.promptId}`}
                onSelect={handleSelectDependency}
                onToggleHidden={toggleDependencyHidden}
                onDetach={setPendingDetachDependency}
              />
            ))}

            {canonicalPrompt.spec.blocks.length === 0 ? (
              <div className="mt-2 rounded-xl border border-dashed border-border/70 px-4 py-4">
                <p className="text-sm font-semibold text-foreground">Structured authoring starts here</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{emptyState}</p>
              </div>
            ) : (
              <SortableContext items={visibleNodes.map((node) => node.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-px">
                  {visibleNodes.map((node) => (
                    <TreeNodeRow
                      key={node.id}
                      node={node}
                      artifactType={canonicalPrompt.spec.artifact.type}
                      isSelected={focusedBlockId === node.id}
                      onSelect={handleSelect}
                      onToggleExpand={toggleBlockCollapsed}
                      onAddChild={handleAddChild}
                      onAddSibling={handleAddSibling}
                      onToggleHidden={toggleBlockHidden}
                      onDelete={setPendingDelete}
                    />
                  ))}
                </div>
              </SortableContext>
            )}
          </div>

          <DragOverlay>
            {activeNode ? (
              <div className="flex h-8 items-center gap-2 rounded-md border border-primary/30 bg-card px-3 text-[13px] font-medium text-foreground shadow-lg">
                <FileText size={13} className="text-primary" />
                {activeNode.title}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </ScrollArea>

      <ConfirmDialog
        open={pendingMove !== null}
        title="Confirm Move"
        description={
          moveNodeData && moveTargetData
            ? `Move "${moveNodeData.title}" before "${moveTargetData.title}"? This will reorder the current tree branch.`
            : ""
        }
        confirmLabel="Confirm"
        onCancel={() => setPendingMove(null)}
        onConfirm={confirmMove}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete Node"
        description={
          deleteNodeData
            ? `Delete "${deleteNodeData.title}"?${deleteNodeData.children.length > 0 ? " This will also delete all children." : ""}`
            : ""
        }
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />

      <ConfirmDialog
        open={pendingDetachDependency !== null}
        title="Detach Dependency"
        description={
          pendingDetachDependency
            ? `Detach "${visibleDependencies.find((dependency) => dependency.promptId === pendingDetachDependency)?.title ?? pendingDetachDependency}" from this prompt?`
            : ""
        }
        confirmLabel="Detach"
        danger
        onCancel={() => setPendingDetachDependency(null)}
        onConfirm={confirmDetachDependency}
      />
    </div>
  );
}
