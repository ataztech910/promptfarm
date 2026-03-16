import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/cn";
import type { PromptEditableDraft, PromptWorkspaceBlock, PromptWorkspaceBlockKind, PromptWorkspaceVariableEntry } from "./promptDocumentAdapter";
import { applyPromptWorkspaceBlocks, createPromptWorkspaceBlock, createPromptWorkspaceBlocks } from "./promptDocumentAdapter";

type PromptBlockWorkspaceProps = {
  workspaceKey: string;
  draft: PromptEditableDraft;
  onChangeDraft: (draft: PromptEditableDraft) => void;
};

const BLOCK_LABELS: Record<PromptWorkspaceBlockKind, string> = {
  prompt: "Prompt",
  variables: "Variables",
  context: "Context",
  example: "Example",
  output_format: "Output Format",
  constraint: "Constraint",
  loop: "Loop",
  conditional: "Conditional",
  metadata: "Metadata",
  generic: "Block",
};

const BLOCK_ACCENTS: Record<PromptWorkspaceBlockKind, string> = {
  prompt: "bg-sky-400",
  variables: "bg-amber-400",
  context: "bg-emerald-400",
  example: "bg-fuchsia-400",
  output_format: "bg-cyan-400",
  constraint: "bg-orange-400",
  loop: "bg-pink-400",
  conditional: "bg-yellow-400",
  metadata: "bg-slate-500",
  generic: "bg-slate-400",
};

const ADD_BLOCK_OPTIONS: PromptWorkspaceBlockKind[] = [
  "prompt",
  "variables",
  "context",
  "example",
  "output_format",
  "constraint",
  "loop",
  "conditional",
  "metadata",
  "generic",
];

const BLOCK_DESCRIPTIONS: Record<PromptWorkspaceBlockKind, string> = {
  prompt: "Primary instruction text with variable interpolation.",
  variables: "Named values that immediately affect the compiled prompt.",
  context: "Background, framing, or extra instruction context.",
  example: "Few-shot input and output pair.",
  output_format: "Describe the exact response structure you expect.",
  constraint: "Rules or restrictions the model must follow.",
  loop: "Repeat a template over a list of items.",
  conditional: "Include content only when a variable is present.",
  metadata: "Render a key/value line into the prompt output.",
  generic: "Fallback freeform block when nothing else fits.",
};

function summarizeBlock(block: PromptWorkspaceBlock): string {
  if (block.kind === "variables") {
    const entries = (block.entries ?? []).filter((entry) => entry.key.trim().length > 0);
    if (entries.length === 0) return "No variables yet";
    return entries.map((entry) => `{{${entry.key.trim()}}}`).join(", ");
  }
  if (block.kind === "example") {
    const input = (block.input ?? "").trim();
    const output = (block.output ?? "").trim();
    if (input.length > 0 || output.length > 0) {
      return [input && `In: ${input}`, output && `Out: ${output}`].filter(Boolean).join(" · ");
    }
    return "No example yet";
  }
  if (block.kind === "context") {
    const label = (block.label ?? "").trim();
    const content = (block.content ?? "").trim();
    return label.length > 0 ? label : content || "No context yet";
  }
  if (block.kind === "loop") {
    const variable = (block.variable ?? "").trim();
    const items = (block.items ?? "").trim();
    if (variable || items) {
      return [variable && `{{${variable}}}`, items && items].filter(Boolean).join(" · ");
    }
    return "No loop yet";
  }
  if (block.kind === "conditional") {
    const variable = (block.variable ?? "").trim();
    return variable.length > 0 ? `If ${variable} exists` : "No condition yet";
  }
  if (block.kind === "metadata") {
    const key = (block.key ?? "").trim();
    const value = (block.value ?? "").trim();
    return key.length > 0 ? `${key}: ${value}`.trim() : "No metadata yet";
  }
  const content = (block.content ?? "").trim();
  return content.length > 0 ? content : "No content yet";
}

export function PromptBlockWorkspace({ workspaceKey, draft, onChangeDraft }: PromptBlockWorkspaceProps) {
  const [blocks, setBlocks] = useState<PromptWorkspaceBlock[]>(() => createPromptWorkspaceBlocks(draft));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ blockId: string; position: "before" | "after" } | null>(null);

  const filteredBlockOptions = useMemo(() => {
    const query = pickerQuery.trim().toLowerCase();
    if (query.length === 0) {
      return ADD_BLOCK_OPTIONS;
    }
    return ADD_BLOCK_OPTIONS.filter((option) => {
      return (
        BLOCK_LABELS[option].toLowerCase().includes(query) ||
        BLOCK_DESCRIPTIONS[option].toLowerCase().includes(query)
      );
    });
  }, [pickerQuery]);

  useEffect(() => {
    setBlocks(createPromptWorkspaceBlocks(draft));
    setPickerOpen(false);
    setPickerQuery("");
    setDraggedBlockId(null);
    setDropTarget(null);
  }, [workspaceKey]);

  useEffect(() => {
    if (!pickerOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPickerOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pickerOpen]);

  function commit(nextBlocks: PromptWorkspaceBlock[]) {
    setBlocks(nextBlocks);
    onChangeDraft(applyPromptWorkspaceBlocks(draft, nextBlocks));
  }

  function updateBlock(blockId: string, patch: Partial<PromptWorkspaceBlock>) {
    commit(blocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block)));
  }

  function moveBlock(blockId: string, direction: "up" | "down") {
    const index = blocks.findIndex((block) => block.id === blockId);
    if (index === -1) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= blocks.length) return;
    const nextBlocks = [...blocks];
    const [moved] = nextBlocks.splice(index, 1);
    nextBlocks.splice(targetIndex, 0, moved!);
    commit(nextBlocks);
  }

  function removeBlock(blockId: string) {
    commit(blocks.filter((block) => block.id !== blockId));
  }

  function addBlock(kind: PromptWorkspaceBlockKind) {
    commit([...blocks, createPromptWorkspaceBlock(kind)]);
  }

  function reorderBlock(sourceBlockId: string, targetBlockId: string, position: "before" | "after") {
    if (sourceBlockId === targetBlockId) return;
    const sourceIndex = blocks.findIndex((block) => block.id === sourceBlockId);
    const targetIndex = blocks.findIndex((block) => block.id === targetBlockId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const nextBlocks = [...blocks];
    const [moved] = nextBlocks.splice(sourceIndex, 1);
    const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
    const insertionIndex = position === "before" ? adjustedTargetIndex : adjustedTargetIndex + 1;
    nextBlocks.splice(insertionIndex, 0, moved!);
    commit(nextBlocks);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          {blocks.map((block, index) => (
            <PromptWorkspaceCard
              key={block.id}
              block={block}
              isFirst={index === 0}
              isLast={index === blocks.length - 1}
              isDragging={draggedBlockId === block.id}
              dropPosition={dropTarget?.blockId === block.id ? dropTarget.position : null}
              onUpdate={(patch) => updateBlock(block.id, patch)}
              onToggle={() => updateBlock(block.id, { enabled: !block.enabled })}
              onToggleCollapse={() => updateBlock(block.id, { collapsed: !block.collapsed })}
              onRemove={() => removeBlock(block.id)}
              onMove={(direction) => moveBlock(block.id, direction)}
              onDragStart={() => setDraggedBlockId(block.id)}
              onDragEnd={() => {
                setDraggedBlockId(null);
                setDropTarget(null);
              }}
              onDragTarget={(position) => {
                if (!draggedBlockId || draggedBlockId === block.id) {
                  setDropTarget(null);
                  return;
                }
                if (!position) {
                  setDropTarget((current) => (current?.blockId === block.id ? null : current));
                  return;
                }
                setDropTarget({ blockId: block.id, position });
              }}
              onDropBlock={(position) => {
                if (!draggedBlockId) return;
                reorderBlock(draggedBlockId, block.id, position);
                setDraggedBlockId(null);
                setDropTarget(null);
              }}
            />
          ))}

          <div className="rounded-2xl border border-dashed border-border/80 bg-card/20 px-4 py-4">
            <div className="space-y-3">
              <Button
                type="button"
                variant="outline"
                className="w-full justify-center rounded-xl border-dashed"
                onClick={() => setPickerOpen(true)}
              >
                <Plus className="h-4 w-4" />
                Add Block
              </Button>
            </div>
          </div>
        </div>
      </div>

      {pickerOpen ? (
        <PromptBlockPickerDialog
          options={filteredBlockOptions}
          query={pickerQuery}
          onQueryChange={setPickerQuery}
          onClose={() => setPickerOpen(false)}
          onPick={(kind) => {
            addBlock(kind);
            setPickerOpen(false);
            setPickerQuery("");
          }}
        />
      ) : null}
    </div>
  );
}

function PromptWorkspaceCard({
  block,
  isFirst,
  isLast,
  isDragging,
  dropPosition,
  onUpdate,
  onToggle,
  onToggleCollapse,
  onRemove,
  onMove,
  onDragStart,
  onDragEnd,
  onDragTarget,
  onDropBlock,
}: {
  block: PromptWorkspaceBlock;
  isFirst: boolean;
  isLast: boolean;
  isDragging: boolean;
  dropPosition: "before" | "after" | null;
  onUpdate: (patch: Partial<PromptWorkspaceBlock>) => void;
  onToggle: () => void;
  onToggleCollapse: () => void;
  onRemove: () => void;
  onMove: (direction: "up" | "down") => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragTarget: (position: "before" | "after" | null) => void;
  onDropBlock: (position: "before" | "after") => void;
}) {
  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        const midpoint = bounds.top + bounds.height / 2;
        onDragTarget(event.clientY < midpoint ? "before" : "after");
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onDragTarget(null);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        const midpoint = bounds.top + bounds.height / 2;
        onDropBlock(event.clientY < midpoint ? "before" : "after");
      }}
      className={cn(
        "group relative rounded-2xl border border-border/80 bg-card/80 transition-all duration-150 hover:border-border hover:bg-card/90",
        block.enabled ? "opacity-100" : "opacity-55",
        isDragging ? "scale-[0.995] opacity-70" : "",
        dropPosition === "before" ? "before:absolute before:-top-2 before:left-6 before:right-6 before:h-0.5 before:rounded before:bg-sky-400 before:content-['']" : "",
        dropPosition === "after" ? "after:absolute after:-bottom-2 after:left-6 after:right-6 after:h-0.5 after:rounded after:bg-sky-400 after:content-['']" : "",
      )}
    >
      <div className={cn("flex items-center gap-2 px-4 py-2.5", !block.collapsed ? "border-b border-border/70" : "")}>
        <button
          type="button"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", block.id);
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          className="rounded p-1 text-muted-foreground opacity-70 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
          aria-label={`Reorder ${BLOCK_LABELS[block.kind]} block`}
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <button type="button" onClick={onToggleCollapse} className="text-muted-foreground transition-colors hover:text-foreground">
          {block.collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        <div className={cn("h-2.5 w-2.5 rounded-full", BLOCK_ACCENTS[block.kind])} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-3">
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/90">
              {BLOCK_LABELS[block.kind]}
            </span>
            <span className="truncate text-sm text-muted-foreground">{summarizeBlock(block)}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
          <button type="button" disabled={isFirst} onClick={() => onMove("up")} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30">
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" disabled={isLast} onClick={() => onMove("down")} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30">
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onRemove} className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            block.enabled ? "bg-sky-500" : "bg-muted/80",
          )}
          aria-pressed={block.enabled}
        >
          <span
            className={cn(
              "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform",
              block.enabled ? "translate-x-4" : "translate-x-0.5",
            )}
          />
        </button>
      </div>

      {!block.collapsed ? (
        <div className="px-4 py-4">
          <PromptWorkspaceBlockBody block={block} onUpdate={onUpdate} />
        </div>
      ) : null}
    </div>
  );
}

function PromptBlockPickerDialog({
  options,
  query,
  onQueryChange,
  onClose,
  onPick,
}: {
  options: PromptWorkspaceBlockKind[];
  query: string;
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onPick: (kind: PromptWorkspaceBlockKind) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm">
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-transparent"
        aria-label="Close add block dialog"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-2xl rounded-3xl border border-border/80 bg-card/95 shadow-2xl">
        <div className="border-b border-border/70 px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Prompt Blocks</div>
          <div className="mt-2 flex items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">Add block to prompt workspace</h2>
            <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
              Cancel
            </Button>
          </div>
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Filter block types..."
            className="mt-4 border-border/70 bg-muted/20"
            autoFocus
          />
        </div>

        <div className="max-h-[60vh] overflow-auto px-5 py-5">
          {options.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onPick(option)}
                  className="rounded-2xl border border-border/80 bg-card/70 p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"
                >
                  <div className="flex items-center gap-2">
                    <div className={cn("h-2.5 w-2.5 rounded-full", BLOCK_ACCENTS[option])} />
                    <div className="text-sm font-semibold text-foreground">{BLOCK_LABELS[option]}</div>
                  </div>
                  <div className="mt-2 text-xs leading-5 text-muted-foreground">{BLOCK_DESCRIPTIONS[option]}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
              No block types match this filter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PromptWorkspaceBlockBody({
  block,
  onUpdate,
}: {
  block: PromptWorkspaceBlock;
  onUpdate: (patch: Partial<PromptWorkspaceBlock>) => void;
}) {
  if (block.kind === "prompt") {
    return (
      <Textarea
        value={block.content ?? ""}
        onChange={(event) => onUpdate({ content: event.target.value })}
        placeholder="Write your prompt here. Use {{variable}} for interpolation."
        className="min-h-[140px] border-0 bg-transparent px-0 py-0 font-mono text-[15px] leading-9 shadow-none focus-visible:ring-0"
      />
    );
  }

  if (block.kind === "variables") {
    return (
      <VariablesEditor
        entries={block.entries ?? []}
        onUpdate={(entries) => onUpdate({ entries })}
      />
    );
  }

  if (block.kind === "context") {
    return (
      <div className="space-y-3">
        <Input
          value={block.label ?? ""}
          onChange={(event) => onUpdate({ label: event.target.value })}
          placeholder="Context label"
          className="border-border/70 bg-muted/30"
        />
        <Textarea
          value={block.content ?? ""}
          onChange={(event) => onUpdate({ content: event.target.value })}
          placeholder="Provide background, framing, or rules."
          className="min-h-[120px] border-0 bg-transparent px-0 py-0 font-mono text-[15px] leading-8 shadow-none focus-visible:ring-0"
        />
      </div>
    );
  }

  if (block.kind === "example") {
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Input</div>
          <Textarea
            value={block.input ?? ""}
            onChange={(event) => onUpdate({ input: event.target.value })}
            placeholder="Example input..."
            className="min-h-[72px] border-border/70 bg-muted/20 font-mono text-[14px] leading-7"
          />
        </div>
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Output</div>
          <Textarea
            value={block.output ?? ""}
            onChange={(event) => onUpdate({ output: event.target.value })}
            placeholder="Expected output..."
            className="min-h-[72px] border-border/70 bg-muted/20 font-mono text-[14px] leading-7"
          />
        </div>
      </div>
    );
  }

  if (block.kind === "output_format" || block.kind === "constraint" || block.kind === "generic") {
    return (
      <div className="space-y-3">
        {block.kind === "generic" ? (
          <select
            className="h-9 w-full rounded-md border border-border/80 bg-background/70 px-3 text-sm text-foreground"
            value={block.role ?? "developer"}
            onChange={(event) => onUpdate({ role: event.target.value as PromptWorkspaceBlock["role"] })}
          >
            <option value="system">system</option>
            <option value="developer">developer</option>
            <option value="user">user</option>
            <option value="assistant">assistant</option>
          </select>
        ) : null}
        <Textarea
          value={block.content ?? ""}
          onChange={(event) => onUpdate({ content: event.target.value })}
          placeholder={
            block.kind === "output_format"
              ? "Describe the target format."
              : block.kind === "constraint"
                ? "Describe the rule or restriction."
                : "Freeform prompt block."
          }
          className="min-h-[120px] border-0 bg-transparent px-0 py-0 font-mono text-[15px] leading-8 shadow-none focus-visible:ring-0"
        />
      </div>
    );
  }

  if (block.kind === "loop") {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Iterator</div>
            <Input
              value={block.variable ?? ""}
              onChange={(event) => onUpdate({ variable: event.target.value })}
              placeholder="item"
              className="border-border/70 bg-muted/20 font-mono"
            />
          </div>
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Items</div>
            <Input
              value={block.items ?? ""}
              onChange={(event) => onUpdate({ items: event.target.value })}
              placeholder="alpha, beta, gamma"
              className="border-border/70 bg-muted/20 font-mono"
            />
          </div>
        </div>
        <Textarea
          value={block.content ?? ""}
          onChange={(event) => onUpdate({ content: event.target.value })}
          placeholder="Use {{item}} inside this template block."
          className="min-h-[120px] border-0 bg-transparent px-0 py-0 font-mono text-[15px] leading-8 shadow-none focus-visible:ring-0"
        />
      </div>
    );
  }

  if (block.kind === "conditional") {
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Variable</div>
          <Input
            value={block.variable ?? ""}
            onChange={(event) => onUpdate({ variable: event.target.value })}
            placeholder="audience"
            className="border-border/70 bg-muted/20 font-mono"
          />
        </div>
        <Textarea
          value={block.content ?? ""}
          onChange={(event) => onUpdate({ content: event.target.value })}
          placeholder="This content appears only if the variable exists."
          className="min-h-[120px] border-0 bg-transparent px-0 py-0 font-mono text-[15px] leading-8 shadow-none focus-visible:ring-0"
        />
      </div>
    );
  }

  if (block.kind === "metadata") {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,220px)_1fr]">
          <Input
            value={block.key ?? ""}
            onChange={(event) => onUpdate({ key: event.target.value })}
            placeholder="Tone"
            className="border-border/70 bg-muted/20 font-mono"
          />
          <Input
            value={block.value ?? ""}
            onChange={(event) => onUpdate({ value: event.target.value })}
            placeholder="technical"
            className="border-border/70 bg-muted/20 font-mono"
          />
        </div>
      </div>
    );
  }

  return null;
}

function VariablesEditor({
  entries,
  onUpdate,
}: {
  entries: PromptWorkspaceVariableEntry[];
  onUpdate: (entries: PromptWorkspaceVariableEntry[]) => void;
}) {
  const normalizedEntries = entries.length > 0 ? entries : [{ key: "", value: "" }];

  function updateEntry(index: number, patch: Partial<PromptWorkspaceVariableEntry>) {
    onUpdate(normalizedEntries.map((entry, entryIndex) => (entryIndex === index ? { ...entry, ...patch } : entry)));
  }

  function addEntry() {
    onUpdate([...normalizedEntries, { key: "", value: "" }]);
  }

  function removeEntry(index: number) {
    if (normalizedEntries.length <= 1) {
      onUpdate([{ key: "", value: "" }]);
      return;
    }
    onUpdate(normalizedEntries.filter((_, entryIndex) => entryIndex !== index));
  }

  return (
    <div className="space-y-3">
      {normalizedEntries.map((entry, index) => (
        <div key={`variable:${index}`} className="group flex items-center gap-2">
          <span className="text-lg font-mono text-sky-400">{`{{`}</span>
          <Input
            value={entry.key}
            onChange={(event) => updateEntry(index, { key: event.target.value })}
            placeholder="variable"
            className="w-40 border-border/70 bg-muted/20 font-mono text-sky-300"
          />
          <span className="text-lg font-mono text-sky-400">{`}}`}</span>
          <span className="text-muted-foreground">=</span>
          <Input
            value={entry.value}
            onChange={(event) => updateEntry(index, { value: event.target.value })}
            placeholder="default value"
            className="flex-1 border-border/70 bg-muted/20 font-mono"
          />
          <button type="button" onClick={() => removeEntry(index)} className="rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/15 hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      <button type="button" onClick={addEntry} className="text-sm text-muted-foreground transition-colors hover:text-primary">
        + Add variable
      </button>
    </div>
  );
}
