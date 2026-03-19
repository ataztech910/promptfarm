import { useEffect, useRef, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import History from "@tiptap/extension-history";
import Dropcursor from "@tiptap/extension-dropcursor";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Block, BlockKind, Variable } from "@promptfarm/editor-core";
import {
  BLOCK_KINDS,
  BLOCK_LABELS,
  BLOCK_DESCRIPTIONS,
  BLOCK_COLORS,
} from "@promptfarm/editor-core";
import { PromptBlockNode, generateBlockId } from "../extensions/PromptBlockNode";
import { SlashCommands } from "../extensions/SlashCommands";
import { cn } from "../cn";

/* ── Types ───────────────────────────────────────────── */

export interface PromptEditorProps {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  variables?: Variable[];
  className?: string;
}

type SlashMenuData = {
  items: BlockKind[];
  rect: DOMRect | null;
  selectedIndex: number;
  command: ((kind: BlockKind) => void) | null;
};

/* ── Helpers ─────────────────────────────────────────── */

function blocksToDoc(blocks: Block[]) {
  const content = blocks.map((b) => ({
    type: "promptBlock" as const,
    attrs: { kind: b.kind, blockId: b.id, enabled: b.enabled },
    content: b.content ? [{ type: "text" as const, text: b.content }] : [],
  }));
  if (content.length === 0) {
    content.push({
      type: "promptBlock",
      attrs: { kind: "task" as const, blockId: generateBlockId(), enabled: true },
      content: [],
    });
  }
  return { type: "doc" as const, content };
}

function extractBlocks(editor: { state: { doc: any } }): Block[] {
  const blocks: Block[] = [];
  editor.state.doc.forEach((node: any) => {
    if (node.type.name === "promptBlock") {
      blocks.push({
        id: node.attrs.blockId ?? generateBlockId(),
        kind: node.attrs.kind,
        content: node.textContent,
        enabled: node.attrs.enabled,
      });
    }
  });
  return blocks;
}

function blocksEqual(a: Block[], b: Block[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (block, i) =>
      block.id === b[i]!.id &&
      block.kind === b[i]!.kind &&
      block.content === b[i]!.content &&
      block.enabled === b[i]!.enabled,
  );
}

function buildDecorations(doc: any, variables: Set<string>) {
  const decorations: Decoration[] = [];
  doc.descendants((node: any, pos: number) => {
    if (!node.isText || !node.text) return;
    const regex = /\{\{(\w+)\}\}/g;
    let match;
    while ((match = regex.exec(node.text)) !== null) {
      const from = pos + match.index;
      const to = from + match[0].length;
      const known = variables.has(match[1]!);
      decorations.push(
        Decoration.inline(from, to, {
          class: known ? "pe-var-known" : "pe-var-unknown",
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

/* ── Component ───────────────────────────────────────── */

export function PromptEditor({
  blocks,
  onChange,
  variables = [],
  className,
}: PromptEditorProps) {
  /* Refs for stable callbacks inside TipTap */
  const variablesRef = useRef(new Set<string>());
  const onChangeRef = useRef(onChange);
  const suppressSync = useRef(false);

  /* Slash menu state — ref is source of truth, tick triggers re-render */
  const slashRef = useRef<SlashMenuData | null>(null);
  const [, setTick] = useState(0);
  const forceRender = () => setTick((n) => n + 1);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    variablesRef.current = new Set(variables.map((v) => v.name));
  }, [variables]);

  /* Extensions (stable, created once) */
  const extensions = useMemo(() => {
    const CustomDocument = Document.extend({ content: "promptBlock+" });

    const VariableHighlight = Extension.create({
      name: "variableHighlight",
      addProseMirrorPlugins() {
        return [
          new Plugin({
            key: new PluginKey("variableHighlight"),
            props: {
              decorations(state) {
                return buildDecorations(state.doc, variablesRef.current);
              },
            },
          }),
        ];
      },
    });

    const slashSuggestion = SlashCommands.configure({
      suggestion: {
        char: "/",
        allowSpaces: false,
        items: ({ query }: { query: string }): BlockKind[] => {
          const q = query.toLowerCase();
          if (!q) return [...BLOCK_KINDS];
          return BLOCK_KINDS.filter(
            (k) =>
              BLOCK_LABELS[k].toLowerCase().includes(q) ||
              BLOCK_DESCRIPTIONS[k].toLowerCase().includes(q),
          );
        },
        command: ({ editor, range, props }: any) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .command(({ tr }: any) => {
              const { $from } = tr.selection;
              const pos = $from.before($from.depth);
              const node = tr.doc.nodeAt(pos);
              if (node?.type.name === "promptBlock") {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  kind: props,
                });
              }
              return true;
            })
            .run();
        },
        render: () => ({
          onStart: (props: any) => {
            slashRef.current = {
              items: props.items,
              rect: props.clientRect?.() ?? null,
              selectedIndex: 0,
              command: props.command,
            };
            forceRender();
          },
          onUpdate: (props: any) => {
            slashRef.current = {
              items: props.items,
              rect: props.clientRect?.() ?? null,
              selectedIndex: 0,
              command: props.command,
            };
            forceRender();
          },
          onKeyDown: ({ event }: any) => {
            const s = slashRef.current;
            if (!s?.items?.length) return false;

            if (event.key === "ArrowDown") {
              s.selectedIndex = (s.selectedIndex + 1) % s.items.length;
              forceRender();
              return true;
            }
            if (event.key === "ArrowUp") {
              s.selectedIndex =
                (s.selectedIndex - 1 + s.items.length) % s.items.length;
              forceRender();
              return true;
            }
            if (event.key === "Enter") {
              s.command?.(s.items[s.selectedIndex]!);
              return true;
            }
            if (event.key === "Escape") {
              slashRef.current = null;
              forceRender();
              return true;
            }
            return false;
          },
          onExit: () => {
            slashRef.current = null;
            forceRender();
          },
        }),
      },
    });

    return [
      CustomDocument,
      PromptBlockNode,
      Text,
      History,
      Dropcursor.configure({ color: "#378ADD", width: 2 }),
      VariableHighlight,
      slashSuggestion,
    ];
  }, []);

  /* Editor instance */
  const editor = useEditor({
    extensions,
    content: blocksToDoc(blocks),
    onUpdate: ({ editor: ed }) => {
      if (suppressSync.current) return;
      onChangeRef.current(extractBlocks(ed));
    },
  });

  /* Sync external block changes → editor */
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = extractBlocks(editor);
    if (blocksEqual(current, blocks)) return;
    suppressSync.current = true;
    editor.commands.setContent(blocksToDoc(blocks));
    suppressSync.current = false;
  }, [blocks, editor]);

  /* Refresh decorations when variables change */
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    // Dispatch no-op transaction to rebuild decorations
    editor.view.dispatch(editor.state.tr);
  }, [variables, editor]);

  /* Read slash menu from ref (re-render triggered by TipTap callbacks) */
  const slash = slashRef.current;

  return (
    <div className={cn("pe-root flex h-full min-h-0 flex-col", className)}>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
        <div className="mx-auto max-w-3xl">
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Slash menu portal */}
      {slash?.rect &&
        slash.items.length > 0 &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="pe-root fixed z-50 w-60 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
            style={{ top: slash.rect.bottom + 6, left: slash.rect.left }}
          >
            <div className="border-b border-gray-100 px-3 py-2">
              <span className="text-[11px] font-medium text-gray-400">
                Add block
              </span>
            </div>
            <div className="max-h-60 overflow-auto py-1">
              {slash.items.map((kind, i) => (
                <button
                  key={kind}
                  type="button"
                  onMouseEnter={() => {
                    if (slashRef.current) slashRef.current.selectedIndex = i;
                    forceRender();
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    slash.command?.(kind);
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 px-3 py-2 text-left transition-colors",
                    i === slash.selectedIndex
                      ? "bg-gray-100"
                      : "hover:bg-gray-50",
                  )}
                >
                  <div
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: BLOCK_COLORS[kind] }}
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-800">
                      {BLOCK_LABELS[kind]}
                    </div>
                    <div className="text-xs text-gray-400">
                      {BLOCK_DESCRIPTIONS[kind]}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
