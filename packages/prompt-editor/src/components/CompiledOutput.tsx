import { useMemo } from "react";
import type { Block } from "@promptfarm/editor-core";
import { BLOCK_LABELS, BLOCK_COLORS } from "@promptfarm/editor-core";
import { cn } from "../cn";

export interface CompiledOutputProps {
  blocks: Block[];
  compiledPrompt: string;
  onRun?: (compiledPrompt: string) => void;
  className?: string;
}

export function CompiledOutput({ blocks, compiledPrompt, onRun, className }: CompiledOutputProps) {
  const sections = useMemo(() => {
    return blocks
      .filter((b) => b.enabled && b.content.trim())
      .map((b) => ({
        id: b.id,
        kind: b.kind,
        label: BLOCK_LABELS[b.kind],
        color: BLOCK_COLORS[b.kind],
      }));
  }, [blocks]);

  const parsed = useMemo(() => {
    if (!compiledPrompt) return [];
    const parts = compiledPrompt.split(/^## (.+)$/m);
    const result: { label: string; content: string; color: string }[] = [];
    for (let i = 1; i < parts.length; i += 2) {
      const label = parts[i]!.trim();
      const content = (parts[i + 1] ?? "").trim();
      const section = sections[result.length];
      result.push({ label, content, color: section?.color ?? "#888" });
    }
    return result;
  }, [compiledPrompt, sections]);

  return (
    <div className={cn("pe-root flex h-full min-h-0 flex-col bg-gray-50", className)}>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {parsed.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-gray-400">Compiled prompt will appear here</p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-5">
            {parsed.map((section, i) => (
              <div key={i}>
                <h3
                  className="mb-2 text-xs font-semibold uppercase tracking-wider"
                  style={{ color: section.color }}
                >
                  {section.label}
                </h3>
                <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-gray-800">
                  {section.content}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>

      {onRun ? (
        <div className="shrink-0 border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            disabled={!compiledPrompt}
            onClick={() => onRun(compiledPrompt)}
            className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-30"
          >
            Run prompt
          </button>
        </div>
      ) : null}
    </div>
  );
}
