import { useMemo } from "react";
import type { Variable, BlockKind } from "@promptfarm/editor-core";
import { BLOCK_LABELS } from "@promptfarm/editor-core";
import type { EditorSegment } from "../components/PromptEditor";

interface MergedSegment {
  type: "text" | "block";
  content: string;
  kind?: BlockKind;
  enabled?: boolean;
  fields?: Record<string, string>;
}

function mergeSegments(segments: EditorSegment[]): MergedSegment[] {
  const merged: MergedSegment[] = [];
  for (const seg of segments) {
    if (seg.type === "text") {
      merged.push({ type: "text", content: seg.content });
    } else {
      const b = seg.block;
      const prev = merged[merged.length - 1];
      if (prev && prev.type === "block" && prev.kind === b.kind && prev.enabled === b.enabled) {
        prev.content += "\n" + b.content;
      } else {
        merged.push({ type: "block", kind: b.kind, content: b.content, enabled: b.enabled, fields: b.fields });
      }
    }
  }
  return merged;
}

function replaceVars(text: string, vars: Variable[]): string {
  return vars.reduce((t, v) => v.value ? t.split(`{{${v.name}}}`).join(v.value) : t, text);
}

export function useCompiledText(segments: EditorSegment[], variables: Variable[] = []): string {
  return useMemo(() => {
    const merged = mergeSegments(segments);
    return merged
      .map((seg) => {
        if (seg.type === "text") return replaceVars(seg.content, variables);
        const hasFields = seg.fields && Object.values(seg.fields).some((v) => v.trim());
        if (!seg.enabled || (!seg.content.trim() && !hasFields)) return "";
        let content: string;
        if (seg.kind === "example" && seg.fields) {
          const inp = seg.fields.input?.trim() ?? "";
          const out = seg.fields.output?.trim() ?? "";
          content = `Input: ${inp}\nOutput: ${out}`;
        } else {
          content = seg.content.trim();
        }
        return `## ${BLOCK_LABELS[seg.kind!]}\n${replaceVars(content, variables)}`;
      })
      .filter(Boolean)
      .join("\n\n");
  }, [segments, variables]);
}
