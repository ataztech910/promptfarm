import { Node, mergeAttributes } from "@tiptap/core";
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  NodeViewContent,
} from "@tiptap/react";
import type { BlockKind } from "@promptfarm/editor-core";
import { BLOCK_COLORS, BLOCK_LABELS } from "@promptfarm/editor-core";
import { cn } from "../cn";

export function generateBlockId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ── Structured fields for special block types ───────── */

function ExampleFields({ fields, onChange }: { fields: Record<string, string>; onChange: (f: Record<string, string>) => void }) {
  return (
    <div className="space-y-2" contentEditable={false}>
      <div>
        <label className="mb-0.5 block text-[11px] font-medium text-gray-400">Input</label>
        <textarea
          value={fields.input ?? ""}
          onChange={(e) => onChange({ ...fields, input: e.target.value })}
          placeholder="Example input…"
          autoFocus
          rows={2}
          className="w-full resize-y rounded border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-300 focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-0.5 block text-[11px] font-medium text-gray-400">Output</label>
        <textarea
          value={fields.output ?? ""}
          onChange={(e) => onChange({ ...fields, output: e.target.value })}
          placeholder="Expected output…"
          rows={2}
          className="w-full resize-y rounded border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-300 focus:outline-none"
        />
      </div>
    </div>
  );
}

const STRUCTURED_KINDS = new Set(["example"]);

/* ── React node view ─────────────────────────────────── */

function BlockView({ node, updateAttributes, deleteNode, editor }: any) {
  const kind: BlockKind = node.attrs.kind;
  const enabled: boolean = node.attrs.enabled;
  const color = BLOCK_COLORS[kind];
  const isEmpty = node.content.size === 0;
  const isOnlyBlock = editor.state.doc.childCount === 1;

  const placeholder =
    isEmpty && isOnlyBlock
      ? "Start writing your prompt… Type / to add a block"
      : isEmpty
        ? `Write ${BLOCK_LABELS[kind].toLowerCase()} content…`
        : null;

  return (
    <NodeViewWrapper
      className={cn("group relative", !enabled && "opacity-40")}
      style={{ borderLeft: `4px solid ${color}` }}
      data-block-id={node.attrs.blockId}
    >
      <div className="flex items-start">
        {/* Drag handle */}
        <div
          contentEditable={false}
          draggable
          data-drag-handle=""
          className="flex shrink-0 cursor-grab items-center self-stretch px-2 text-gray-300 opacity-0 transition-opacity select-none group-hover:opacity-100 active:cursor-grabbing"
        >
          <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
            <circle cx="3" cy="2" r="1.2" />
            <circle cx="7" cy="2" r="1.2" />
            <circle cx="3" cy="8" r="1.2" />
            <circle cx="7" cy="8" r="1.2" />
            <circle cx="3" cy="14" r="1.2" />
            <circle cx="7" cy="14" r="1.2" />
          </svg>
        </div>

        <div className="min-w-0 flex-1 px-3 py-3">
          {/* Header */}
          <div className="mb-1 flex items-center" contentEditable={false}>
            <span
              className="text-xs font-medium select-none"
              style={{ color }}
            >
              {BLOCK_LABELS[kind].toLowerCase()}
            </span>

            <div className="ml-auto flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => updateAttributes({ enabled: !enabled })}
                className="text-gray-400 transition-colors hover:text-gray-600"
                title={enabled ? "Disable" : "Enable"}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {enabled ? (
                    <>
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  ) : (
                    <>
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </>
                  )}
                </svg>
              </button>
              <button
                type="button"
                onClick={deleteNode}
                className="text-gray-400 transition-colors hover:text-red-500"
                title="Delete"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Editable content + placeholder */}
          {STRUCTURED_KINDS.has(kind) ? (
            <ExampleFields
              fields={node.attrs.fields ?? {}}
              onChange={(f) => updateAttributes({ fields: f })}
            />
          ) : (
            <div className="relative">
              <NodeViewContent className="text-sm leading-relaxed text-gray-900" style={{ minHeight: "1.5em", outline: "none" }} />
              {placeholder && (
                <span className="pointer-events-none absolute left-0 top-0 text-sm text-gray-400">
                  {placeholder}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

/* ── TipTap node definition ──────────────────────────── */

export const PromptBlockNode = Node.create({
  name: "promptBlock",
  group: "block",
  content: "inline*",
  draggable: true,

  addAttributes() {
    return {
      kind: { default: "task" },
      blockId: { default: null },
      enabled: { default: true },
      fields: { default: {} },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-prompt-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-prompt-block": "" }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockView);
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        const atEnd = $from.parentOffset === $from.parent.content.size;

        return editor
          .chain()
          .splitBlock()
          .command(({ tr }) => {
            const { $from: newFrom } = tr.selection;
            const pos = newFrom.before(newFrom.depth);
            const node = tr.doc.nodeAt(pos);
            if (node?.type.name === "promptBlock") {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                kind: node.attrs.kind,
                blockId: generateBlockId(),
              });
            }
            return true;
          })
          .run();
      },

      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parentOffset !== 0) return false;

        const parent = $from.parent;

        // Delete empty block (keep at least one)
        if (parent.content.size === 0 && editor.state.doc.childCount > 1) {
          const pos = $from.before($from.depth);
          editor.view.dispatch(
            editor.state.tr.delete(pos, pos + parent.nodeSize),
          );
          return true;
        }

        // Prevent joining blocks
        return true;
      },
    };
  },
});
