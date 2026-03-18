import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, Plus, Trash2 } from "lucide-react";
import { cn } from "./cn";
import { Button, Input, Textarea } from "./components/ui";
import { createPromptWorkspaceBlock } from "./promptDocumentAdapter";
import type { PromptWorkspaceBlock, PromptWorkspaceBlockKind, PromptWorkspaceVariableEntry, GenericRoleOption } from "./promptDocumentAdapter";

export type PromptBlockEditorProps = {
  blocks: PromptWorkspaceBlock[];
  onChange: (blocks: PromptWorkspaceBlock[]) => void;
  /** Pass a new value to reset internal state (e.g. when switching prompts) */
  resetKey?: string;
  className?: string;
  /** Custom role options for the generic block dropdown. */
  genericRoleOptions?: GenericRoleOption[];
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
  "prompt", "variables", "context", "example",
  "output_format", "constraint", "loop", "conditional", "metadata", "generic",
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
    const entries = (block.entries ?? []).filter((e) => e.key.trim().length > 0);
    return entries.length === 0 ? "No variables yet" : entries.map((e) => `{{${e.key.trim()}}}`).join(", ");
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
    if (variable || items) return [variable && `{{${variable}}}`, items].filter(Boolean).join(" · ");
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

function hasMeaningfulContent(block: PromptWorkspaceBlock): boolean {
  if (block.kind === "variables") return (block.entries ?? []).some((e) => e.key.trim().length > 0 || e.value.trim().length > 0);
  if (block.kind === "example") return (block.input ?? "").trim().length > 0 || (block.output ?? "").trim().length > 0;
  if (block.kind === "context") return (block.label ?? "").trim().length > 0 || (block.content ?? "").trim().length > 0;
  if (block.kind === "loop") return (block.variable ?? "").trim().length > 0 || (block.items ?? "").trim().length > 0 || (block.content ?? "").trim().length > 0;
  if (block.kind === "conditional") return (block.variable ?? "").trim().length > 0 || (block.content ?? "").trim().length > 0;
  if (block.kind === "metadata") return (block.key ?? "").trim().length > 0 || (block.value ?? "").trim().length > 0;
  return (block.content ?? "").trim().length > 0;
}

const DEFAULT_GENERIC_ROLES: GenericRoleOption[] = [
  { name: "system", description: "System-level instruction" },
  { name: "developer", description: "Developer-level instruction" },
  { name: "user", description: "User message" },
  { name: "assistant", description: "Assistant message" },
];

export function PromptBlockEditor({ blocks, onChange, resetKey, className, genericRoleOptions }: PromptBlockEditorProps) {
  const roles = genericRoleOptions ?? DEFAULT_GENERIC_ROLES;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ blockId: string; position: "before" | "after" } | null>(null);
  const [pendingDeleteBlockId, setPendingDeleteBlockId] = useState<string | null>(null);

  const filteredBlockOptions = useMemo(() => {
    const query = pickerQuery.trim().toLowerCase();
    if (query.length === 0) return ADD_BLOCK_OPTIONS;
    return ADD_BLOCK_OPTIONS.filter((o) =>
      BLOCK_LABELS[o].toLowerCase().includes(query) || BLOCK_DESCRIPTIONS[o].toLowerCase().includes(query),
    );
  }, [pickerQuery]);

  const pendingDeleteBlock = useMemo(
    () => (pendingDeleteBlockId ? blocks.find((b) => b.id === pendingDeleteBlockId) ?? null : null),
    [blocks, pendingDeleteBlockId],
  );

  useEffect(() => {
    setPickerOpen(false);
    setPickerQuery("");
    setDraggedBlockId(null);
    setDropTarget(null);
    setPendingDeleteBlockId(null);
  }, [resetKey]);

  useEffect(() => {
    if (!pickerOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPickerOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pickerOpen]);

  function updateBlock(blockId: string, patch: Partial<PromptWorkspaceBlock>) {
    onChange(blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)));
  }

  function moveBlock(blockId: string, direction: "up" | "down") {
    const index = blocks.findIndex((b) => b.id === blockId);
    if (index === -1) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= blocks.length) return;
    const next = [...blocks];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved!);
    onChange(next);
  }

  function removeBlock(blockId: string) {
    onChange(blocks.filter((b) => b.id !== blockId));
  }

  function requestRemoveBlock(blockId: string) {
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;
    if (hasMeaningfulContent(block)) {
      setPendingDeleteBlockId(blockId);
      return;
    }
    removeBlock(blockId);
  }

  function addBlock(kind: PromptWorkspaceBlockKind) {
    onChange([...blocks, createPromptWorkspaceBlock(kind)]);
  }

  function reorderBlock(sourceId: string, targetId: string, position: "before" | "after") {
    if (sourceId === targetId) return;
    const sourceIndex = blocks.findIndex((b) => b.id === sourceId);
    const targetIndex = blocks.findIndex((b) => b.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...blocks];
    const [moved] = next.splice(sourceIndex, 1);
    const adjusted = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
    next.splice(position === "before" ? adjusted : adjusted + 1, 0, moved!);
    onChange(next);
  }

  return (
    <div className={cn("pe-root flex h-full min-h-0 flex-col", className)}>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          {blocks.map((block, index) => (
            <BlockCard
              key={block.id}
              block={block}
              isFirst={index === 0}
              isLast={index === blocks.length - 1}
              isDragging={draggedBlockId === block.id}
              dropPosition={dropTarget?.blockId === block.id ? dropTarget.position : null}
              genericRoleOptions={roles}
              onUpdate={(patch) => updateBlock(block.id, patch)}
              onToggle={() => updateBlock(block.id, { enabled: !block.enabled })}
              onToggleCollapse={() => updateBlock(block.id, { collapsed: !block.collapsed })}
              onRemove={() => requestRemoveBlock(block.id)}
              onMove={(dir) => moveBlock(block.id, dir)}
              onDragStart={() => setDraggedBlockId(block.id)}
              onDragEnd={() => { setDraggedBlockId(null); setDropTarget(null); }}
              onDragTarget={(pos) => {
                if (!draggedBlockId || draggedBlockId === block.id) { setDropTarget(null); return; }
                if (!pos) { setDropTarget((cur) => (cur?.blockId === block.id ? null : cur)); return; }
                setDropTarget({ blockId: block.id, position: pos });
              }}
              onDropBlock={(pos) => {
                if (!draggedBlockId) return;
                reorderBlock(draggedBlockId, block.id, pos);
                setDraggedBlockId(null);
                setDropTarget(null);
              }}
            />
          ))}

          <div className="rounded-2xl border border-dashed border-border/80 bg-card/20 px-4 py-4">
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

      {pickerOpen ? (
        <BlockPickerDialog
          options={filteredBlockOptions}
          query={pickerQuery}
          onQueryChange={setPickerQuery}
          onClose={() => setPickerOpen(false)}
          onPick={(kind) => { addBlock(kind); setPickerOpen(false); setPickerQuery(""); }}
        />
      ) : null}

      {pendingDeleteBlock ? (
        <BlockDeleteDialog
          block={pendingDeleteBlock}
          onCancel={() => setPendingDeleteBlockId(null)}
          onConfirm={() => { removeBlock(pendingDeleteBlock.id); setPendingDeleteBlockId(null); }}
        />
      ) : null}
    </div>
  );
}

function BlockCard({
  block, isFirst, isLast, isDragging, dropPosition, genericRoleOptions,
  onUpdate, onToggle, onToggleCollapse, onRemove, onMove,
  onDragStart, onDragEnd, onDragTarget, onDropBlock,
}: {
  block: PromptWorkspaceBlock;
  isFirst: boolean;
  isLast: boolean;
  isDragging: boolean;
  dropPosition: "before" | "after" | null;
  genericRoleOptions: GenericRoleOption[];
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
      onDragOver={(e) => {
        e.preventDefault();
        const bounds = e.currentTarget.getBoundingClientRect();
        onDragTarget(e.clientY < bounds.top + bounds.height / 2 ? "before" : "after");
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onDragTarget(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const bounds = e.currentTarget.getBoundingClientRect();
        onDropBlock(e.clientY < bounds.top + bounds.height / 2 ? "before" : "after");
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
          onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", block.id); onDragStart(); }}
          onDragEnd={onDragEnd}
          className="rounded p-1 text-muted-foreground opacity-70 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
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
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors",
            block.enabled ? "bg-sky-500" : "bg-muted/80",
          )}
          aria-pressed={block.enabled}
        >
          <span className={cn("pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform", block.enabled ? "translate-x-4" : "translate-x-0.5")} />
        </button>
      </div>

      {!block.collapsed ? (
        <div className="px-4 py-4">
          <BlockBody block={block} onUpdate={onUpdate} genericRoleOptions={genericRoleOptions} />
        </div>
      ) : null}
    </div>
  );
}

function BlockPickerDialog({ options, query, onQueryChange, onClose, onPick }: {
  options: PromptWorkspaceBlockKind[];
  query: string;
  onQueryChange: (v: string) => void;
  onClose: () => void;
  onPick: (kind: PromptWorkspaceBlockKind) => void;
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pe-root fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm">
      <button type="button" className="absolute inset-0 cursor-default bg-transparent" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-3xl border border-border/80 bg-card/95 shadow-2xl">
        <div className="border-b border-border/70 px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Prompt Blocks</div>
          <div className="mt-2 flex items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">Add block</h2>
            <Button type="button" variant="ghost" className="ml-auto text-sm px-2 py-1 h-auto" onClick={onClose}>Cancel</Button>
          </div>
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
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
    </div>,
    document.body,
  );
}

function BlockDeleteDialog({ block, onCancel, onConfirm }: {
  block: PromptWorkspaceBlock;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pe-root fixed inset-0 z-[60] flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm">
      <button type="button" className="absolute inset-0 cursor-default bg-transparent" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-border/80 bg-card/95 p-6 shadow-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Delete Block</p>
        <h2 className="mt-3 text-lg font-semibold text-foreground">{BLOCK_LABELS[block.kind]}</h2>
        <p className="mt-2 text-sm text-muted-foreground">This block already contains content. Remove it?</p>
        <div className="mt-4 rounded-lg border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          {summarizeBlock(block)}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant="secondary" onClick={onConfirm}>
            <Trash2 className="h-4 w-4" />
            Delete Block
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function BlockBody({ block, onUpdate, genericRoleOptions }: { block: PromptWorkspaceBlock; onUpdate: (patch: Partial<PromptWorkspaceBlock>) => void; genericRoleOptions: GenericRoleOption[] }) {
  if (block.kind === "prompt") {
    return (
      <Textarea
        value={block.content ?? ""}
        onChange={(e) => onUpdate({ content: e.target.value })}
        placeholder="Write your prompt here. Use {{variable}} for interpolation."
        className="min-h-[140px] border-0 bg-transparent px-0 py-0 font-mono text-[15px] leading-9 shadow-none focus-visible:ring-0"
      />
    );
  }
  if (block.kind === "variables") {
    return <VariablesEditor entries={block.entries ?? []} onUpdate={(entries) => onUpdate({ entries })} />;
  }
  if (block.kind === "context") {
    return (
      <div className="space-y-3">
        <Input value={block.label ?? ""} onChange={(e) => onUpdate({ label: e.target.value })} placeholder="Context label" className="border-border/70 bg-muted/30" />
        <Textarea value={block.content ?? ""} onChange={(e) => onUpdate({ content: e.target.value })} placeholder="Provide background, framing, or rules." className="min-h-[120px] border-0 bg-transparent px-0 py-0 font-mono text-[15px] leading-8 shadow-none focus-visible:ring-0" />
      </div>
    );
  }
  if (block.kind === "example") {
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Input</div>
          <Textarea value={block.input ?? ""} onChange={(e) => onUpdate({ input: e.target.value })} placeholder="Example input..." className="min-h-[72px] border-border/70 bg-muted/20 font-mono text-[14px] leading-7" />
        </div>
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Output</div>
          <Textarea value={block.output ?? ""} onChange={(e) => onUpdate({ output: e.target.value })} placeholder="Expected output..." className="min-h-[72px] border-border/70 bg-muted/20 font-mono text-[14px] leading-7" />
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
            value={block.role ?? genericRoleOptions[0]?.name ?? "developer"}
            onChange={(e) => onUpdate({ role: e.target.value as PromptWorkspaceBlock["role"] })}
          >
            {genericRoleOptions.map((opt) => (
              <option key={opt.name} value={opt.name}>{opt.name}</option>
            ))}
          </select>
        ) : null}
        <Textarea value={block.content ?? ""} onChange={(e) => onUpdate({ content: e.target.value })} placeholder={block.kind === "output_format" ? "Describe the target format." : block.kind === "constraint" ? "Describe the rule or restriction." : "Freeform prompt block."} className="min-h-[120px] border-0 bg-transparent px-0 py-0 font-mono text-[15px] leading-8 shadow-none focus-visible:ring-0" />
      </div>
    );
  }
  if (block.kind === "loop") {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Iterator</div>
            <Input value={block.variable ?? ""} onChange={(e) => onUpdate({ variable: e.target.value })} placeholder="item" className="border-border/70 bg-muted/20 font-mono" />
          </div>
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Items</div>
            <Input value={block.items ?? ""} onChange={(e) => onUpdate({ items: e.target.value })} placeholder="alpha, beta, gamma" className="border-border/70 bg-muted/20 font-mono" />
          </div>
        </div>
        <Textarea value={block.content ?? ""} onChange={(e) => onUpdate({ content: e.target.value })} placeholder="Use {{item}} inside this template block." className="min-h-[120px] border-0 bg-transparent px-0 py-0 font-mono text-[15px] leading-8 shadow-none focus-visible:ring-0" />
      </div>
    );
  }
  if (block.kind === "conditional") {
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Variable</div>
          <Input value={block.variable ?? ""} onChange={(e) => onUpdate({ variable: e.target.value })} placeholder="audience" className="border-border/70 bg-muted/20 font-mono" />
        </div>
        <Textarea value={block.content ?? ""} onChange={(e) => onUpdate({ content: e.target.value })} placeholder="This content appears only if the variable exists." className="min-h-[120px] border-0 bg-transparent px-0 py-0 font-mono text-[15px] leading-8 shadow-none focus-visible:ring-0" />
      </div>
    );
  }
  if (block.kind === "metadata") {
    return (
      <div className="grid gap-3 md:grid-cols-[minmax(0,220px)_1fr]">
        <Input value={block.key ?? ""} onChange={(e) => onUpdate({ key: e.target.value })} placeholder="Tone" className="border-border/70 bg-muted/20 font-mono" />
        <Input value={block.value ?? ""} onChange={(e) => onUpdate({ value: e.target.value })} placeholder="technical" className="border-border/70 bg-muted/20 font-mono" />
      </div>
    );
  }
  return null;
}

function VariablesEditor({ entries, onUpdate }: { entries: PromptWorkspaceVariableEntry[]; onUpdate: (entries: PromptWorkspaceVariableEntry[]) => void }) {
  const normalized = entries.length > 0 ? entries : [{ key: "", value: "" }];

  function updateEntry(index: number, patch: Partial<PromptWorkspaceVariableEntry>) {
    onUpdate(normalized.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  return (
    <div className="space-y-3">
      {normalized.map((entry, index) => (
        <div key={`variable:${index}`} className="group flex items-center gap-2">
          <span className="font-mono text-lg text-sky-400">{`{{`}</span>
          <Input value={entry.key} onChange={(e) => updateEntry(index, { key: e.target.value })} placeholder="variable" className="w-40 border-border/70 bg-muted/20 font-mono text-sky-300" />
          <span className="font-mono text-lg text-sky-400">{`}}`}</span>
          <span className="text-muted-foreground">=</span>
          <Input value={entry.value} onChange={(e) => updateEntry(index, { value: e.target.value })} placeholder="default value" className="flex-1 border-border/70 bg-muted/20 font-mono" />
          <button
            type="button"
            onClick={() => {
              if (normalized.length <= 1) { onUpdate([{ key: "", value: "" }]); return; }
              onUpdate(normalized.filter((_, i) => i !== index));
            }}
            className="rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/15 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onUpdate([...normalized, { key: "", value: "" }])} className="text-sm text-muted-foreground transition-colors hover:text-primary">
        + Add variable
      </button>
    </div>
  );
}
