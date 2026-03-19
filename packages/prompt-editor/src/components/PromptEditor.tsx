import { useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { BlockKind } from "@promptfarm/editor-core";
import { BLOCK_KINDS, BLOCK_LABELS, BLOCK_DESCRIPTIONS, BLOCK_COLORS } from "@promptfarm/editor-core";
import { PromptBlockNode } from "../extensions/PromptBlockNode";
import { cn } from "../cn";

export interface EditorBlock {
  id: string;
  kind: BlockKind;
  content: string;
  enabled: boolean;
  fields?: Record<string, string>;
}

export type EditorSegment =
  | { type: "text"; content: string }
  | { type: "block"; block: EditorBlock };

export interface PromptEditorProps {
  value?: string;
  onChange?: (text: string, blocks: EditorBlock[], segments: EditorSegment[]) => void;
  className?: string;
}

function isInsidePromptBlock(editor: any): boolean {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "promptBlock") return true;
  }
  return false;
}

export function PromptEditor({ value, onChange, className }: PromptEditorProps) {
  const [menu, setMenu] = useState<{ rect: DOMRect; query: string } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const filtered = menu
    ? BLOCK_KINDS.filter((k) => {
        const q = menu.query.toLowerCase();
        if (!q) return true;
        return BLOCK_LABELS[k].toLowerCase().includes(q) || BLOCK_DESCRIPTIONS[k].toLowerCase().includes(q);
      })
    : [];

  const editor = useEditor({
    extensions: [StarterKit, PromptBlockNode],
    content: value ?? undefined,
    onUpdate: ({ editor: ed }) => {
      const blocks: EditorBlock[] = [];
      const segments: EditorSegment[] = [];
      const doc = ed.state.doc;
      doc.forEach((node: any, offset: number) => {
        // +1 to skip into the node content, nodeSize-2 for inner content length
        const from = offset + 1;
        const to = offset + node.nodeSize - 1;
        const text = to > from ? doc.textBetween(from, to, "\n", "\n") : "";
        if (node.type.name === "promptBlock") {
          const fields = node.attrs.fields && Object.keys(node.attrs.fields).length > 0
            ? node.attrs.fields
            : undefined;
          const block: EditorBlock = {
            id: node.attrs.blockId ?? crypto.randomUUID(),
            kind: node.attrs.kind,
            content: text,
            enabled: node.attrs.enabled,
            fields,
          };
          blocks.push(block);
          segments.push({ type: "block", block });
        } else if (text.trim()) {
          segments.push({ type: "text", content: text });
        }
      });
      onChange?.(ed.getText(), blocks, segments);

      // Slash menu only outside promptBlock
      if (isInsidePromptBlock(ed)) {
        setMenu(null);
        return;
      }

      const { from } = ed.state.selection;
      const textBefore = ed.state.doc.textBetween(Math.max(0, from - 50), from, "\n");
      const slashMatch = textBefore.match(/\/([a-zA-Z_]*)$/);

      if (slashMatch) {
        const coords = ed.view.coordsAtPos(from);
        setMenu({ rect: new DOMRect(coords.left, coords.bottom, 0, 0), query: slashMatch[1] ?? "" });
        setSelectedIndex(0);
      } else {
        setMenu(null);
      }
    },
    editorProps: {
      handleKeyDown: (_view, event) => {
        if (!menu || filtered.length === 0) return false;
        if (event.key === "ArrowDown") { event.preventDefault(); setSelectedIndex((i) => (i + 1) % filtered.length); return true; }
        if (event.key === "ArrowUp") { event.preventDefault(); setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length); return true; }
        if (event.key === "Enter") { event.preventDefault(); pickBlock(filtered[selectedIndex]!); return true; }
        if (event.key === "Escape") { event.preventDefault(); setMenu(null); return true; }
        return false;
      },
    },
  });

  const pickBlock = useCallback(
    (kind: BlockKind) => {
      if (!editor) return;
      const { state } = editor;
      const { from } = state.selection;
      const textBefore = state.doc.textBetween(Math.max(0, from - 50), from, "\n");
      const slashIdx = textBefore.lastIndexOf("/");
      if (slashIdx >= 0) {
        const deleteFrom = from - (textBefore.length - slashIdx);
        editor.chain().focus().deleteRange({ from: deleteFrom, to: from }).run();
      }
      // Insert promptBlock node
      editor.chain().focus().insertContent({
        type: "promptBlock",
        attrs: { kind, blockId: crypto.randomUUID(), enabled: true },
      }).run();
      setMenu(null);
    },
    [editor],
  );

  useEffect(() => {
    if (!menuRef.current) return;
    const el = menuRef.current.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <div
      className={cn("pe-root h-full cursor-text overflow-auto bg-white px-8 py-6", className)}
      onClick={(e) => {
        if (e.target === e.currentTarget && editor) editor.commands.focus("end");
      }}
    >
      <EditorContent
        editor={editor}
        className="tiptap-wrapper prose prose-sm max-w-none focus:outline-none [&_.tiptap]:outline-none"
      />

      {menu && filtered.length > 0 && typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed z-50 w-60 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
            style={{ top: menu.rect.bottom + 6, left: menu.rect.left }}
          >
            <div className="border-b border-gray-100 px-3 py-2">
              <span className="text-[11px] font-medium text-gray-400">Add block</span>
            </div>
            <div ref={menuRef} className="max-h-60 overflow-auto py-1">
              {filtered.map((kind, i) => (
                <button
                  key={kind}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(i)}
                  onMouseDown={(e) => { e.preventDefault(); pickBlock(kind); }}
                  className={cn(
                    "flex w-full items-start gap-3 px-3 py-2 text-left transition-colors",
                    i === selectedIndex ? "bg-gray-100" : "hover:bg-gray-50",
                  )}
                >
                  <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: BLOCK_COLORS[kind] }} />
                  <div>
                    <div className="text-sm font-medium text-gray-800">{BLOCK_LABELS[kind]}</div>
                    <div className="text-xs text-gray-400">{BLOCK_DESCRIPTIONS[kind]}</div>
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
