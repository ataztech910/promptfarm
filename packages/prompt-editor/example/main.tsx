import { useState, useMemo, useRef, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PromptEditor, VariablesBar, BLOCK_LABELS, BLOCK_COLORS } from "../src";
import type { EditorSegment, BlockKind, Variable } from "../src";
import "./styles.css";

const BLOCK_TEMPLATES: Record<string, (content: string) => string> = {
  role: (c) => `[Your role is: ${c}]`,
  context: (c) => `[Context: ${c}]`,
  task: (c) => `[Task: ${c}]`,
  example: (c) => `[Example]\nInput/Output:\n${c}`,
  output_format: (c) => `[Output format: ${c}]`,
  constraint: (c) => `[Constraint: ${c}]`,
};

type MergedSegment =
  | { type: "text"; content: string; key: string }
  | { type: "block"; kind: BlockKind; content: string; enabled: boolean; key: string; fields?: Record<string, string> };

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
        merged.push({ type: "block", kind: b.kind, content: b.content, enabled: b.enabled, key: b.id, fields: b.fields });
      }
    }
  }
  return merged;
}

function replaceVars(text: string, vars: Variable[]): string {
  return vars.reduce((t, v) => v.value ? t.replaceAll(`{{${v.name}}}`, v.value) : t, text);
}

function App() {
  const [segments, setSegments] = useState<EditorSegment[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  const editorRef = useRef<{ insertText: (text: string) => void }>(null);
  const merged = useMemo(() => mergeSegments(segments), [segments]);

  return (
    <div className="grid h-screen grid-cols-2">
      <div className="flex h-full flex-col">
        <VariablesBar
          variables={variables}
          onChange={setVariables}
          onInsert={(name) => editorRef.current?.insertText(`{{${name}}}`)}
          className="border-b border-gray-200"
        />
        <PromptEditor
          onChange={(_t, _b, segs) => { setSegments(segs); }}
          className="flex-1"
        />
      </div>
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
                    {replaceVars(seg.content, variables)}
                  </pre>
                );
              }
              const hasFields = seg.fields && Object.values(seg.fields).some((v) => v.trim());
              if (!seg.enabled || (!seg.content.trim() && !hasFields)) return null;

              let compiled: string;
              if (seg.kind === "example" && seg.fields) {
                const inp = seg.fields.input?.trim() ?? "";
                const out = seg.fields.output?.trim() ?? "";
                compiled = `[Example]\nInput: ${inp}\nOutput: ${out}`;
              } else {
                compiled = BLOCK_TEMPLATES[seg.kind]?.(seg.content.trim()) ?? seg.content.trim();
              }

              return (
                <div key={seg.key}>
                  <div
                    className="mb-1 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: BLOCK_COLORS[seg.kind] }}
                  >
                    {BLOCK_LABELS[seg.kind]}
                  </div>
                  <pre className="whitespace-pre-wrap font-mono text-sm text-gray-800">
                    {replaceVars(compiled, variables)}
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
