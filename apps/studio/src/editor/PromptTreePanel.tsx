import { useEffect, useMemo, useRef, useState } from "react";
import { closestCenter, DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, ExternalLink, Eye, EyeOff, FileText, FolderTree, GitBranchPlus, GripVertical, Link2, Plus, Sparkles, Trash2, type LucideIcon } from "lucide-react";
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
import {
  promotePromptBlockToSkillModule,
  readSkillModuleReference,
  replacePromptBlockWithSkillModuleReference,
  type SkillModuleReference,
} from "../model/skillModulePromotion";
import {
  listStudioPromptDocumentsFromRemote,
  readStudioPromptDocumentFromLocalCacheSnapshot,
  readStudioPromptDocumentFromRemote,
  type StudioPromptDocumentRecord,
  type StudioPromptDocumentSummary,
  writeStudioPromptDocumentToRemote,
} from "../runtime/studioPromptDocumentRemote";
import { useStudioStore } from "../state/studioStore";
import { ConfirmDialog } from "./ConfirmDialog";
import { toast } from "sonner";
import { Input } from "../components/ui/input";

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

function formatModuleReferenceMeta(reference: SkillModuleReference): string {
  return `module reference • ${reference.inputNames.length} var${reference.inputNames.length === 1 ? "" : "s"}`;
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
  onPromote,
  onOpenModule,
  onReuse,
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
  onPromote: (id: string) => void;
  onOpenModule: (promptId: string) => void;
  onReuse: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const hasChildren = node.block.children.length > 0;
  const moduleReference = readSkillModuleReference(node.block);

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
          <div className="truncate text-[11px] text-muted-foreground">
            {moduleReference ? formatModuleReferenceMeta(moduleReference) : formatBlockMeta(node.block, node.childKind, artifactType)}
          </div>
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
          {moduleReference ? (
            <ActionButton icon={ExternalLink} label="Open module" onClick={() => onOpenModule(moduleReference.promptId)} />
          ) : (
            <ActionButton icon={Link2} label="Reuse existing skill" onClick={() => onReuse(node.id)} />
          )}
          {!moduleReference ? <ActionButton icon={Sparkles} label="Promote to reusable skill" onClick={() => onPromote(node.id)} /> : null}
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
  const currentProjectName = useStudioStore((s) => s.currentProjectName);
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
  const hydratePromptDocument = useStudioStore((s) => s.hydratePromptDocument);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingDetachDependency, setPendingDetachDependency] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<string | null>(null);
  const [promotionTitle, setPromotionTitle] = useState("");
  const [promotionOpenInNewTab, setPromotionOpenInNewTab] = useState(true);
  const [promotionSubmitting, setPromotionSubmitting] = useState(false);
  const [pendingReuse, setPendingReuse] = useState<string | null>(null);
  const [reusePromptId, setReusePromptId] = useState<string>("");
  const [reuseSubmitting, setReuseSubmitting] = useState(false);
  const [reusePreviewRecord, setReusePreviewRecord] = useState<StudioPromptDocumentRecord | null>(null);
  const [reusePreviewStatus, setReusePreviewStatus] = useState<"idle" | "loading" | "error">("idle");
  const [reusePreviewError, setReusePreviewError] = useState<string | null>(null);
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

  const reusablePromptCandidates = useMemo(() => {
    if (!canonicalPrompt) {
      return [];
    }
    return availablePrompts.filter((prompt) => prompt.artifactType === canonicalPrompt.spec.artifact.type);
  }, [availablePrompts, canonicalPrompt]);

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

  useEffect(() => {
    let cancelled = false;

    if (!pendingReuse || !reusePromptId) {
      setReusePreviewRecord(null);
      setReusePreviewStatus("idle");
      setReusePreviewError(null);
      return;
    }

    const localRecord = readStudioPromptDocumentFromLocalCacheSnapshot(reusePromptId);
    setReusePreviewRecord(localRecord);
    setReusePreviewStatus(localRecord ? "idle" : "loading");
    setReusePreviewError(null);

    void readStudioPromptDocumentFromRemote(reusePromptId)
      .then((record) => {
        if (cancelled) {
          return;
        }
        setReusePreviewRecord(record);
        if (!record) {
          setReusePreviewStatus("error");
          setReusePreviewError(`Prompt "${reusePromptId}" could not be loaded.`);
          return;
        }
        setReusePreviewStatus("idle");
        setReusePreviewError(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setReusePreviewStatus("error");
        setReusePreviewError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [pendingReuse, reusePromptId]);

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
  const reusePreviewTags = reusePreviewRecord?.prompt.metadata.tags ?? [];
  const reusePreviewIsSkillModule = reusePreviewTags.includes("skill_module");

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

  function handlePromoteNode(blockId: string) {
    const block = canonicalPrompt ? findPromptBlockById(canonicalPrompt.spec.blocks, blockId) : null;
    setPendingPromotion(blockId);
    setPromotionTitle(block ? `${block.title} Skill Module` : "Reusable Skill Module");
    setPromotionOpenInNewTab(true);
  }

  function handleReuseNode(blockId: string) {
    setPendingReuse(blockId);
    setReusePromptId(reusablePromptCandidates[0]?.promptId ?? "");
  }

  function handleOpenModule(promptId: string) {
    if (typeof window === "undefined") {
      return;
    }
    window.open(`/studio/prompts/${encodeURIComponent(promptId)}`, "_blank", "noopener,noreferrer");
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

  async function confirmPromotion(): Promise<void> {
    if (!canonicalPrompt || !pendingPromotion) {
      return;
    }

    setPromotionSubmitting(true);
    try {
      const result = promotePromptBlockToSkillModule({
        prompt: canonicalPrompt,
        blockId: pendingPromotion,
        moduleTitle: promotionTitle,
      });

      await Promise.all([
        writeStudioPromptDocumentToRemote({
          prompt: result.modulePrompt,
          projectId: currentProjectId,
        }),
        writeStudioPromptDocumentToRemote({
          prompt: result.updatedPrompt,
          projectId: currentProjectId,
        }),
      ]);

      hydratePromptDocument(result.updatedPrompt, `promote://${result.referenceBlockId}`, {
        projectId: currentProjectId,
        projectName: currentProjectName,
      });

      if (promotionOpenInNewTab && typeof window !== "undefined") {
        window.open(`/studio/prompts/${encodeURIComponent(result.modulePrompt.metadata.id)}`, "_blank", "noopener,noreferrer");
      }

      toast.success(
        `Promoted "${result.modulePrompt.metadata.title}" into a reusable skill module${result.extractedInputNames.length > 0 ? ` with ${result.extractedInputNames.length} extracted variable${result.extractedInputNames.length === 1 ? "" : "s"}` : ""}.`,
      );
      setPendingPromotion(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not promote the selected subtree.");
    } finally {
      setPromotionSubmitting(false);
    }
  }

  async function confirmReuse(): Promise<void> {
    if (!canonicalPrompt || !pendingReuse || !reusePromptId) {
      return;
    }

    setReuseSubmitting(true);
    try {
      const record = reusePreviewRecord ?? readStudioPromptDocumentFromLocalCacheSnapshot(reusePromptId) ?? (await readStudioPromptDocumentFromRemote(reusePromptId));
      if (!record) {
        throw new Error(`Prompt "${reusePromptId}" could not be loaded.`);
      }

      const result = replacePromptBlockWithSkillModuleReference({
        prompt: canonicalPrompt,
        blockId: pendingReuse,
        modulePrompt: record.prompt,
      });

      await writeStudioPromptDocumentToRemote({
        prompt: result.updatedPrompt,
        projectId: currentProjectId,
      });

      hydratePromptDocument(result.updatedPrompt, `reuse://${result.referenceBlockId}`, {
        projectId: currentProjectId,
        projectName: currentProjectName,
      });

      toast.success(
        `Reused "${record.prompt.metadata.title ?? record.prompt.metadata.id}" as a skill module${result.reusedInputNames.length > 0 ? ` with ${result.reusedInputNames.length} variable${result.reusedInputNames.length === 1 ? "" : "s"}` : ""}.`,
      );
      setPendingReuse(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reuse the selected skill module.");
    } finally {
      setReuseSubmitting(false);
    }
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
                      onPromote={handlePromoteNode}
                      onOpenModule={handleOpenModule}
                      onReuse={handleReuseNode}
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

      {pendingPromotion && canonicalPrompt ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm"
          onClick={() => {
            if (!promotionSubmitting) {
              setPendingPromotion(null);
            }
          }}
        >
          <div
            className="w-[28rem] rounded-xl border border-border bg-card p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="mb-1.5 text-base font-semibold text-foreground">Promote to Reusable Skill</h3>
            <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
              Create a reusable skill prompt from this subtree, attach it as a root dependency, and replace the subtree with a reference block.
            </p>
            <div className="space-y-2">
              <label htmlFor="promote-skill-title" className="text-sm font-medium text-foreground">
                Skill module title
              </label>
              <Input
                id="promote-skill-title"
                value={promotionTitle}
                onChange={(event) => setPromotionTitle(event.target.value)}
                placeholder="Reusable Skill Module"
                disabled={promotionSubmitting}
              />
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border border-input bg-muted/40"
                checked={promotionOpenInNewTab}
                onChange={(event) => setPromotionOpenInNewTab(event.target.checked)}
                disabled={promotionSubmitting}
              />
              Open the promoted skill in a new tab
            </label>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setPendingPromotion(null)}
                disabled={promotionSubmitting}
                className="flex-1 rounded-lg bg-muted px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmPromotion()}
                disabled={promotionSubmitting || promotionTitle.trim().length === 0}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {promotionSubmitting ? "Promoting..." : "Promote"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingReuse && canonicalPrompt ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm"
          onClick={() => {
            if (!reuseSubmitting) {
              setPendingReuse(null);
            }
          }}
        >
          <div
            className="w-[30rem] rounded-xl border border-border bg-card p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="mb-1.5 text-base font-semibold text-foreground">Reuse Existing Skill Module</h3>
            <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
              Replace this subtree with a reference to an existing prompt from the current workspace and attach it as a root dependency.
            </p>
            <div className="space-y-2">
              <label htmlFor="reuse-skill-module" className="text-sm font-medium text-foreground">
                Existing skill prompt
              </label>
              <select
                id="reuse-skill-module"
                value={reusePromptId}
                onChange={(event) => setReusePromptId(event.target.value)}
                disabled={reuseSubmitting || reusablePromptCandidates.length === 0}
                className="h-9 w-full rounded-md border border-input bg-muted/40 px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {reusablePromptCandidates.length === 0 ? <option value="">No reusable prompts available</option> : null}
                {reusablePromptCandidates.map((prompt) => (
                  <option key={prompt.promptId} value={prompt.promptId}>
                    {prompt.title} · {prompt.promptId}
                  </option>
                ))}
              </select>
              <div className="text-xs text-muted-foreground">
                Only prompts with the same artifact type are shown here.
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-border/70 bg-muted/20 px-4 py-3">
              {reusePreviewRecord ? (
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-foreground">{reusePreviewRecord.prompt.metadata.title ?? reusePreviewRecord.summary.promptId}</div>
                  <div className="text-[11px] text-muted-foreground">{reusePreviewRecord.summary.promptId}</div>
                  <div className="text-[11px] text-muted-foreground">
                    Tags: {reusePreviewTags.length > 0 ? reusePreviewTags.join(", ") : "(none)"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Variables:{" "}
                    {reusePreviewRecord.prompt.spec.inputs.length > 0
                      ? reusePreviewRecord.prompt.spec.inputs.map((input) => input.name).join(", ")
                      : "(none)"}
                  </div>
                  {!reusePreviewIsSkillModule ? (
                    <div className="text-[11px] text-amber-300">
                      This prompt is not tagged as `skill_module`. You can still reuse it, but it is not explicitly marked as a reusable module.
                    </div>
                  ) : null}
                  <div>
                    <a
                      href={`/studio/prompts/${encodeURIComponent(reusePreviewRecord.summary.promptId)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-primary underline underline-offset-4"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open Prompt
                    </a>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  {reusePreviewStatus === "loading"
                    ? "Loading prompt preview..."
                    : reusePreviewError ?? "Select a reusable prompt to inspect its module interface."}
                </div>
              )}
            </div>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setPendingReuse(null)}
                disabled={reuseSubmitting}
                className="flex-1 rounded-lg bg-muted px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmReuse()}
                disabled={reuseSubmitting || reusePromptId.length === 0 || reusablePromptCandidates.length === 0}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {reuseSubmitting ? "Reusing..." : "Reuse"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
