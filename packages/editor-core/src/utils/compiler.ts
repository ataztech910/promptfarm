import type { Block, Variable } from "../types/block";
import { BLOCK_LABELS } from "../types/block";

export type CompileResult = {
  text: string;
  tokenCount: number;
  activeBlockCount: number;
};

export function compile(blocks: Block[], variables: Variable[] = []): CompileResult {
  const vars: Record<string, string> = {};
  for (const v of variables) {
    if (v.name.trim()) vars[v.name.trim()] = v.value;
  }

  function interpolate(text: string): string {
    return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match);
  }

  const parts: string[] = [];
  let activeBlockCount = 0;

  for (const block of blocks) {
    if (!block.enabled) continue;
    const content = interpolate(block.content.trim());
    if (!content) continue;

    const label = BLOCK_LABELS[block.kind];
    parts.push(`## ${label}\n${content}`);
    activeBlockCount += 1;
  }

  const text = parts.join("\n\n");
  const tokenCount = text.split(/\s+/).filter(Boolean).length;

  return { text, tokenCount, activeBlockCount };
}
