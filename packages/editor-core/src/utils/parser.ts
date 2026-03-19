import type { Block, BlockKind } from "../types/block";

const HEADING_TO_KIND: Record<string, BlockKind> = {
  "Role": "role",
  "Context": "context",
  "Task": "task",
  "Example": "example",
  "Output Format": "output_format",
  "Constraint": "constraint",
};

function generateId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function parsePromptMd(md: string): Block[] {
  // Strip YAML frontmatter
  const body = md.replace(/^---[\s\S]*?---\s*/, "");

  const blocks: Block[] = [];
  const headingRe = /^## (.+)$/gm;
  const matches: { heading: string; start: number }[] = [];

  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(body)) !== null) {
    matches.push({ heading: m[1]!, start: m.index + m[0].length });
  }

  for (let i = 0; i < matches.length; i++) {
    const { heading, start } = matches[i]!;
    const end = i + 1 < matches.length ? matches[i + 1]!.start - `## ${matches[i + 1]!.heading}`.length : body.length;
    const content = body.slice(start, end).trim();

    const kind = HEADING_TO_KIND[heading] ?? "context";

    blocks.push({
      id: generateId(),
      kind,
      content,
      enabled: true,
    });
  }

  return blocks;
}
