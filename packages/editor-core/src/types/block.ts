export type BlockKind =
  | "role"
  | "context"
  | "task"
  | "example"
  | "output_format"
  | "constraint"
  | "loop"
  | "conditional";

export type Block = {
  id: string;
  kind: BlockKind;
  content: string;
  enabled: boolean;
  name?: string;
};

export type Variable = {
  name: string;
  value: string;
};

export const BLOCK_LABELS: Record<BlockKind, string> = {
  role: "Role",
  context: "Context",
  task: "Task",
  example: "Example",
  output_format: "Output Format",
  constraint: "Constraint",
  loop: "Loop",
  conditional: "Conditional",
};

export const BLOCK_DESCRIPTIONS: Record<BlockKind, string> = {
  role: "Define the AI persona",
  context: "Background info",
  task: "Main instruction",
  example: "Few-shot example",
  output_format: "Expected response structure",
  constraint: "Rules or restrictions",
  loop: "Repeat over a list",
  conditional: "Include if variable exists",
};

export const BLOCK_COLORS: Record<BlockKind, string> = {
  role: "#7F77DD",
  context: "#1D9E75",
  task: "#378ADD",
  example: "#D4537E",
  output_format: "#EF9F27",
  constraint: "#E24B4A",
  loop: "#888780",
  conditional: "#888780",
};

export const BLOCK_KINDS: BlockKind[] = [
  "role",
  "context",
  "task",
  "example",
  "output_format",
  "constraint",
  "loop",
  "conditional",
];

export function createBlock(kind: BlockKind): Block {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, kind, content: "", enabled: true };
}
