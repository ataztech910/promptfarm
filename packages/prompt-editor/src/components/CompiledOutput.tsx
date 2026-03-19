import { useMemo } from "react";
import { Play } from "lucide-react";
import type { BlockKind } from "@promptfarm/editor-core";
import { BLOCK_COLORS } from "@promptfarm/editor-core";
import { CopyButton } from "./CopyButton";
import { cn } from "../cn";

export interface CompiledOutputProps {
  compiledPrompt: string;
  onRun?: (compiledPrompt: string) => void;
  className?: string;
}

type ParsedSection =
  | { type: "text"; content: string }
  | { type: "block"; label: string; content: string; color: string };

const LABEL_TO_KIND: Record<string, BlockKind> = {
  "Role": "role",
  "Context": "context",
  "Task": "task",
  "Example": "example",
  "Output Format": "output_format",
  "Constraint": "constraint",
};

export function CompiledOutput({ compiledPrompt, onRun, className }: CompiledOutputProps) {
  const parsed = useMemo(() => {
    if (!compiledPrompt) return [] as ParsedSection[];
    const result: ParsedSection[] = [];

    // Split on ## headings, keeping the heading text
    const parts = compiledPrompt.split(/^(## .+)$/m);

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const headingMatch = part.match(/^## (.+)$/);
      if (headingMatch) {
        const label = headingMatch[1]!.trim();
        const content = (parts[i + 1] ?? "").trim();
        const kind = LABEL_TO_KIND[label];
        const color = kind ? BLOCK_COLORS[kind] : "#888";
        result.push({ type: "block", label, content, color });
        i++; // skip content part
      } else if (part.trim()) {
        result.push({ type: "text", content: part.trim() });
      }
    }
    return result;
  }, [compiledPrompt]);

  return (
    <div className={cn("pe-root flex h-full min-h-0 flex-col bg-gray-50", className)}>
      <div className="flex min-h-[44px] shrink-0 items-center justify-between border-b border-gray-200 px-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Compiled Prompt
        </h2>
        {compiledPrompt && <CopyButton text={compiledPrompt} />}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {parsed.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-gray-400">Start typing in the editor… Use / to add blocks</p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-5">
            {parsed.map((section, i) => {
              if (section.type === "text") {
                return (
                  <pre key={i} className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-gray-800">
                    {section.content}
                  </pre>
                );
              }
              return (
                <div key={i}>
                  <h3
                    className="mb-2 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: section.color }}
                  >
                    ## {section.label}
                  </h3>
                  <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-gray-800">
                    {section.content}
                  </pre>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {onRun ? (
        <div className="shrink-0 border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            disabled={!compiledPrompt}
            onClick={() => onRun(compiledPrompt)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-30"
          >
            <Play size={14} />
            Run prompt
          </button>
        </div>
      ) : null}
    </div>
  );
}
