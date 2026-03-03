import type { Prompt } from "../../types/prompts.js";
import { renderMustacheLite, type TemplateVars } from "../template.js";

export function renderGeneric(p: Prompt, vars: TemplateVars = {}): string {
  const lines: string[] = [];

  lines.push(`# ${p.title}`);
  lines.push(`id: ${p.id}`);
  lines.push(`version: ${p.version}`);
  if (p.tags?.length) lines.push(`tags: ${p.tags.join(", ")}`);
  lines.push("");

  for (const m of p.messages) {
    lines.push(`## ${m.role}`);
    lines.push(renderMustacheLite(m.content, vars).trimEnd());
    lines.push("");
  }

  return lines.join("\n");
}