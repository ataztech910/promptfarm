import { useState, useMemo, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PromptEditor, BLOCK_LABELS, BLOCK_COLORS } from "../src";
import type { EditorSegment, BlockKind } from "../src";
import "./styles.css";

const BLOCK_TEMPLATES: Record<string, (content: string) => string> = {
  role: (c) => `[Your role is: ${c}]`,
  context: (c) => `[Context: ${c}]`,
  task: (c) => `[Task: ${c}]`,
  example: (c) => `[Example]\nInput/Output:\n${c}`,
  output_format: (c) => `[Output format: ${c}]`,
  constraint: (c) => `[Constraint: ${c}]`,
  loop: (c) => `[For each item: ${c}]`,
  conditional: (c) => `[If applicable: ${c}]`,
};

type MergedSegment =
  | { type: "text"; content: string; key: string }
  | { type: "block"; kind: BlockKind; content: string; enabled: boolean; key: string };

/** Merge consecutive blocks of the same kind into one segment */
function mergeSegments(segments: EditorSegment[]): MergedSegment[] {
  const merged: MergedSegment[] = [];
  for (const seg of segments) {
    if (seg.type === "text") {
      merged.push({ type: "text", content: seg.content, key: `t-${merged.length}` });
    } else {
      const b = seg.block;
      const prev = merged[merged.length - 1];
      if (prev && prev.type === "block" && prev.kind === b.kind && prev.enabled === b.enabled) {
        prev.content += "\n" + b.content;
      } else {
        merged.push({ type: "block", kind: b.kind, content: b.content, enabled: b.enabled, key: b.id });
      }
    }
  }
  return merged;
}

function App() {
  const [segments, setSegments] = useState<EditorSegment[]>([]);
  const merged = useMemo(() => mergeSegments(segments), [segments]);

  return (
    <div className="grid h-screen grid-cols-2">
      <PromptEditor
        onChange={(_t, _b, segs) => { setSegments(segs); }}
      />
      <div className="overflow-auto border-l border-gray-200 bg-gray-50 px-8 py-6">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Compiled Prompt
        </h2>
        {merged.length > 0 ? (
          <div className="space-y-4">
            {merged.map((seg) => {
              if (seg.type === "text") {
                return (
                  <pre key={seg.key} className="whitespace-pre-wrap font-mono text-sm text-gray-800">
                    {seg.content}
                  </pre>
                );
              }
              if (!seg.enabled || !seg.content.trim()) return null;
              return (
                <div key={seg.key}>
                  <div
                    className="mb-1 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: BLOCK_COLORS[seg.kind] }}
                  >
                    {BLOCK_LABELS[seg.kind]}
                  </div>
                  <pre className="whitespace-pre-wrap font-mono text-sm text-gray-800">
                    {BLOCK_TEMPLATES[seg.kind]?.(seg.content.trim()) ?? seg.content.trim()}
                  </pre>
                </div>
              );
            })}
          </div>
        ) : (
          <pre className="whitespace-pre-wrap font-mono text-sm text-gray-400">
            Start typing in the editor… Use / to add blocks
          </pre>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
