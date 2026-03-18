import type { OutputData, OutputBlockData } from "@editorjs/editorjs";
import type { BlockDraft, InputDraft, MessageDraft, RootDraft } from "./editorSession";

export type PromptEditableDraft = RootDraft | BlockDraft;
export type PromptDocumentPresetKind = "context" | "example" | "output_format" | "constraint";
export type PromptDocumentAdditionalBlockKind =
  | "context"
  | "example_input"
  | "example_output"
  | "output_format"
  | "constraint"
  | "loop"
  | "conditional"
  | "metadata"
  | "generic";
export type PromptDocumentEditorToolName =
  | "promptInstruction"
  | "context"
  | "exampleInput"
  | "exampleOutput"
  | "outputFormat"
  | "constraint"
  | "generic";

export type PromptDocumentEditorBlockData = {
  kind: PromptDocumentAdditionalBlockKind | "prompt_instruction";
  content: string;
  role?: MessageDraft["role"];
};

export type PromptWorkspaceBlockKind =
  | "prompt"
  | "variables"
  | "context"
  | "example"
  | "output_format"
  | "constraint"
  | "loop"
  | "conditional"
  | "metadata"
  | "generic";

export type PromptWorkspaceVariableEntry = {
  key: string;
  value: string;
};

export type PromptWorkspaceBlock = {
  id: string;
  kind: PromptWorkspaceBlockKind;
  enabled: boolean;
  collapsed: boolean;
  role?: MessageDraft["role"];
  label?: string;
  content?: string;
  input?: string;
  output?: string;
  variable?: string;
  items?: string;
  key?: string;
  value?: string;
  entries?: PromptWorkspaceVariableEntry[];
};

export type PromptWorkspaceCompileResult = {
  text: string;
  tokenCount: number;
  activeBlockCount: number;
};

export type PromptDocumentAdditionalBlock = {
  index: number;
  kind: PromptDocumentAdditionalBlockKind;
  title: string;
  description: string;
};

export type PromptDocumentModel = {
  primaryInstructionIndex: number;
  contextMessageIndex: number;
  additionalMessageIndexes: number[];
  additionalBlocks: PromptDocumentAdditionalBlock[];
};

function firstMeaningfulLine(content: string): string | null {
  const line = content
    .split("\n")
    .map((value) => value.trim())
    .find((value) => value.length > 0);
  return line ?? null;
}

function stripPrefixedHeading(content: string, prefix: string): string {
  const normalizedPrefix = prefix.toLowerCase();
  const lines = content.split("\n");
  if (lines.length === 0) return content;
  const firstLine = lines[0]?.trim().toLowerCase() ?? "";
  if (!firstLine.startsWith(normalizedPrefix)) {
    return content;
  }
  return lines.slice(1).join("\n").trimStart();
}

function parseContextBlock(content: string): { label: string; content: string } {
  const lines = content.split("\n");
  const firstLine = lines[0]?.trim() ?? "";
  const bracketMatch = firstLine.match(/^\[context:\s*(.+)\]$/i);
  if (bracketMatch) {
    return {
      label: bracketMatch[1]?.trim() ?? "",
      content: lines.slice(1).join("\n").trimStart(),
    };
  }
  const prefixMatch = firstLine.match(/^additional context:\s*(.*)$/i);
  if (prefixMatch) {
    return {
      label: prefixMatch[1]?.trim() ?? "",
      content: lines.slice(1).join("\n").trimStart(),
    };
  }
  return { label: "", content };
}

function parseLoopBlock(content: string): { variable: string; items: string; body: string } {
  const lines = content.split("\n");
  const firstLine = lines[0]?.trim() ?? "";
  const bracketMatch = firstLine.match(/^\[loop:\s*(.+)\]$/i);
  const variable = bracketMatch?.[1]?.trim() ?? "";
  const secondLine = lines[1]?.trim() ?? "";
  const itemsMatch = secondLine.match(/^items:\s*(.*)$/i);
  return {
    variable,
    items: itemsMatch?.[1]?.trim() ?? "",
    body: lines.slice(itemsMatch ? 2 : 1).join("\n").trimStart(),
  };
}

function parseConditionalBlock(content: string): { variable: string; body: string } {
  const lines = content.split("\n");
  const firstLine = lines[0]?.trim() ?? "";
  const bracketMatch = firstLine.match(/^\[conditional:\s*(.+)\]$/i);
  return {
    variable: bracketMatch?.[1]?.trim() ?? "",
    body: lines.slice(bracketMatch ? 1 : 0).join("\n").trimStart(),
  };
}

function parseMetadataBlock(content: string): { key: string; value: string } {
  const lines = content.split("\n");
  const firstLine = lines[0]?.trim() ?? "";
  const bracketMatch = firstLine.match(/^\[metadata:\s*(.+)\]$/i);
  return {
    key: bracketMatch?.[1]?.trim() ?? "",
    value: lines.slice(bracketMatch ? 1 : 0).join("\n").trimStart(),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inputDraftDefaultValue(input: InputDraft): string {
  const trimmed = input.defaultValue.trim();
  if (trimmed.length === 0) {
    return "";
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "string") {
      return parsed;
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

function classifyPromptDocumentAdditionalBlock(message: MessageDraft, index: number): PromptDocumentAdditionalBlock {
  const firstLine = firstMeaningfulLine(message.content) ?? "";
  const normalized = firstLine.toLowerCase();

  if (normalized.startsWith("additional context:")) {
    return {
      index,
      kind: "context",
      title: "Additional Context",
      description: "Supplemental context block that adds more reference material or framing.",
    };
  }

  if (normalized.startsWith("example input:")) {
    return {
      index,
      kind: "example_input",
      title: "Example Input",
      description: "Few-shot example input block used to demonstrate the expected request pattern.",
    };
  }

  if (normalized.startsWith("example output:")) {
    return {
      index,
      kind: "example_output",
      title: "Example Output",
      description: "Few-shot example output block used to demonstrate the expected result pattern.",
    };
  }

  if (normalized.startsWith("output format:")) {
    return {
      index,
      kind: "output_format",
      title: "Output Format",
      description: "Structured formatting guidance for the model response.",
    };
  }

  if (normalized.startsWith("constraint:")) {
    return {
      index,
      kind: "constraint",
      title: "Constraint",
      description: "A rule or restriction that should stay true during generation.",
    };
  }

  if (normalized.startsWith("[loop:")) {
    return {
      index,
      kind: "loop",
      title: "Loop",
      description: "Repeat a template across a list of items using a local iterator variable.",
    };
  }

  if (normalized.startsWith("[conditional:")) {
    return {
      index,
      kind: "conditional",
      title: "Conditional",
      description: "Include the block only when a named variable is present.",
    };
  }

  if (normalized.startsWith("[metadata:")) {
    return {
      index,
      kind: "metadata",
      title: "Metadata",
      description: "Key/value instruction metadata that compiles into the prompt output.",
    };
  }

  return {
    index,
    kind: "generic",
    title: describePromptDocumentMessage(message, index),
    description: "Fallback raw block for anything that does not map cleanly to a typed prompt-document block yet.",
  };
}

export function createPromptDocumentModel(draft: PromptEditableDraft): PromptDocumentModel {
  const primaryInstructionIndex = draft.messages.findIndex((message) => message.role === "user");
  const contextMessageIndex = draft.messages.findIndex((message) => {
    if (message.role === "system") {
      return true;
    }
    if (message.role !== "developer") {
      return false;
    }
    return classifyPromptDocumentAdditionalBlock(message, -1).kind === "context";
  });
  const additionalMessageIndexes = draft.messages
    .map((_, index) => index)
    .filter((index) => index !== primaryInstructionIndex && index !== contextMessageIndex);

  return {
    primaryInstructionIndex,
    contextMessageIndex,
    additionalMessageIndexes,
    additionalBlocks: additionalMessageIndexes.map((index) =>
      classifyPromptDocumentAdditionalBlock(draft.messages[index]!, index),
    ),
  };
}

export function describePromptDocumentMessage(message: MessageDraft, index: number): string {
  const line = firstMeaningfulLine(message.content);
  if (!line) {
    return `Block ${index + 1}`;
  }
  return line.length > 48 ? `${line.slice(0, 45)}...` : line;
}

export function upsertPromptDocumentPrimary(
  draft: PromptEditableDraft,
  target: "instruction" | "context",
  content: string,
): PromptEditableDraft {
  const model = createPromptDocumentModel(draft);

  if (target === "instruction") {
    if (model.primaryInstructionIndex >= 0) {
      return {
        ...draft,
        messages: draft.messages.map((message, index) =>
          index === model.primaryInstructionIndex ? { ...message, role: "user", content } : message,
        ),
      };
    }
    return {
      ...draft,
      messages: [...draft.messages, { role: "user", content }],
    };
  }

  if (model.contextMessageIndex >= 0) {
    return {
      ...draft,
      messages: draft.messages.map((message, index) =>
        index === model.contextMessageIndex ? { ...message, content } : message,
      ),
    };
  }

  return {
    ...draft,
    messages: [{ role: "system", content }, ...draft.messages],
  };
}

export function addPromptDocumentPresetBlock(
  draft: PromptEditableDraft,
  preset: PromptDocumentPresetKind,
): PromptEditableDraft {
  if (preset === "context") {
    return {
      ...draft,
      messages: [...draft.messages, { role: "developer", content: "Additional context:\n" }],
    };
  }

  if (preset === "example") {
    return {
      ...draft,
      messages: [
        ...draft.messages,
        { role: "user", content: "Example input:\n" },
        { role: "assistant", content: "Example output:\n" },
      ],
    };
  }

  if (preset === "output_format") {
    return {
      ...draft,
      messages: [
        ...draft.messages,
        { role: "developer", content: "Output format:\n- Return concise structured markdown." },
      ],
    };
  }

  return {
    ...draft,
    messages: [...draft.messages, { role: "developer", content: "Constraint:\n- Preserve factual accuracy." }],
  };
}

export function createPromptWorkspaceBlocks(draft: PromptEditableDraft): PromptWorkspaceBlock[] {
  const blocks: PromptWorkspaceBlock[] = [];

  // Variables first — stored in draft.inputs, has no position in the messages array
  blocks.push({
    id: "variables",
    kind: "variables",
    enabled: true,
    collapsed: false,
    entries: draft.inputs.map((input) => ({
      key: input.name,
      value: inputDraftDefaultValue(input),
    })),
  });

  // Iterate messages in their exact order — no hardcoded positions
  let i = 0;
  while (i < draft.messages.length) {
    const message = draft.messages[i]!;
    const firstLine = (message.content.split("\n")[0] ?? "").trim().toLowerCase();

    if (firstLine.startsWith("example input:")) {
      const nextMessage = draft.messages[i + 1];
      const nextFirstLine = (nextMessage?.content.split("\n")[0] ?? "").trim().toLowerCase();
      if (nextMessage && nextFirstLine.startsWith("example output:")) {
        blocks.push({
          id: `example:${i}`,
          kind: "example",
          enabled: true,
          collapsed: false,
          input: stripPrefixedHeading(message.content, "Example input:"),
          output: stripPrefixedHeading(nextMessage.content, "Example output:"),
        });
        i += 2;
        continue;
      }
      blocks.push({
        id: `example:${i}`,
        kind: "example",
        enabled: true,
        collapsed: false,
        input: stripPrefixedHeading(message.content, "Example input:"),
        output: "",
      });
      i += 1;
      continue;
    }

    if (firstLine.startsWith("example output:")) {
      blocks.push({
        id: `example:${i}`,
        kind: "example",
        enabled: true,
        collapsed: false,
        input: "",
        output: stripPrefixedHeading(message.content, "Example output:"),
      });
      i += 1;
      continue;
    }

    if (firstLine.startsWith("additional context:") || firstLine.startsWith("[context:") || message.role === "system") {
      const parsed = parseContextBlock(message.content);
      blocks.push({
        id: `context:${i}`,
        kind: "context",
        enabled: true,
        collapsed: false,
        role: message.role,
        label: parsed.label,
        content: parsed.content,
      });
      i += 1;
      continue;
    }

    if (firstLine.startsWith("output format:")) {
      blocks.push({
        id: `output_format:${i}`,
        kind: "output_format",
        enabled: true,
        collapsed: false,
        content: stripPrefixedHeading(message.content, "Output format:"),
      });
      i += 1;
      continue;
    }

    if (firstLine.startsWith("constraint:")) {
      blocks.push({
        id: `constraint:${i}`,
        kind: "constraint",
        enabled: true,
        collapsed: false,
        content: stripPrefixedHeading(message.content, "Constraint:"),
      });
      i += 1;
      continue;
    }

    if (firstLine.startsWith("[loop:")) {
      const parsed = parseLoopBlock(message.content);
      blocks.push({
        id: `loop:${i}`,
        kind: "loop",
        enabled: true,
        collapsed: false,
        variable: parsed.variable,
        items: parsed.items,
        content: parsed.body,
      });
      i += 1;
      continue;
    }

    if (firstLine.startsWith("[conditional:")) {
      const parsed = parseConditionalBlock(message.content);
      blocks.push({
        id: `conditional:${i}`,
        kind: "conditional",
        enabled: true,
        collapsed: false,
        variable: parsed.variable,
        content: parsed.body,
      });
      i += 1;
      continue;
    }

    if (firstLine.startsWith("[metadata:")) {
      const parsed = parseMetadataBlock(message.content);
      blocks.push({
        id: `metadata:${i}`,
        kind: "metadata",
        enabled: true,
        collapsed: false,
        key: parsed.key,
        value: parsed.value,
      });
      i += 1;
      continue;
    }

    if (message.role === "user") {
      blocks.push({
        id: `prompt:${i}`,
        kind: "prompt",
        enabled: true,
        collapsed: false,
        role: "user",
        content: message.content,
      });
      i += 1;
      continue;
    }

    blocks.push({
      id: `generic:${i}`,
      kind: "generic",
      enabled: true,
      collapsed: false,
      role: message.role,
      content: message.content,
    });
    i += 1;
  }

  return blocks;
}

export function createPromptWorkspaceBlock(kind: PromptWorkspaceBlockKind): PromptWorkspaceBlock {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`;

  if (kind === "prompt") {
    return { id: `prompt:${suffix}`, kind, enabled: true, collapsed: false, role: "user", content: "" };
  }
  if (kind === "variables") {
    return { id: `variables:${suffix}`, kind, enabled: true, collapsed: false, entries: [{ key: "", value: "" }] };
  }
  if (kind === "context") {
    return { id: `context:${suffix}`, kind, enabled: true, collapsed: false, role: "system", label: "", content: "" };
  }
  if (kind === "example") {
    return { id: `example:${suffix}`, kind, enabled: true, collapsed: false, input: "", output: "" };
  }
  if (kind === "loop") {
    return { id: `loop:${suffix}`, kind, enabled: true, collapsed: false, variable: "item", items: "", content: "" };
  }
  if (kind === "conditional") {
    return { id: `conditional:${suffix}`, kind, enabled: true, collapsed: false, variable: "", content: "" };
  }
  if (kind === "metadata") {
    return { id: `metadata:${suffix}`, kind, enabled: true, collapsed: false, key: "", value: "" };
  }
  if (kind === "output_format" || kind === "constraint" || kind === "generic") {
    return { id: `${kind}:${suffix}`, kind, enabled: true, collapsed: false, role: "developer", content: "" };
  }
  return { id: `generic:${suffix}`, kind: "generic", enabled: true, collapsed: false, role: "developer", content: "" };
}

export function compilePromptWorkspaceBlocks(blocks: PromptWorkspaceBlock[]): PromptWorkspaceCompileResult {
  const activeBlocks = blocks.filter((block) => block.enabled);
  const variables: Record<string, string> = {};

  for (const block of activeBlocks) {
    if (block.kind !== "variables") continue;
    for (const entry of block.entries ?? []) {
      const key = entry.key.trim();
      if (key.length > 0) {
        variables[key] = entry.value;
      }
    }
  }

  function interpolate(text: string): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? `{{${key}}}`);
  }

  const parts: string[] = [];
  let activeBlockCount = 0;

  for (const block of activeBlocks) {
    if (block.kind === "variables") {
      activeBlockCount += 1;
      continue;
    }

    if (block.kind === "prompt") {
      const content = interpolate((block.content ?? "").trim());
      if (content.length > 0) {
        parts.push(content);
        activeBlockCount += 1;
      }
      continue;
    }

    if (block.kind === "context") {
      const content = interpolate((block.content ?? "").trim());
      if (content.length > 0) {
        const label = (block.label ?? "").trim() || "Context";
        parts.push(`[Context: ${label}]\n${content}`);
        activeBlockCount += 1;
      }
      continue;
    }

    if (block.kind === "example") {
      const input = interpolate((block.input ?? "").trim());
      const output = interpolate((block.output ?? "").trim());
      if (input.length > 0 || output.length > 0) {
        parts.push(`[Example]\nInput: ${input}\nOutput: ${output}`);
        activeBlockCount += 1;
      }
      continue;
    }

    if (block.kind === "output_format") {
      const content = interpolate((block.content ?? "").trim());
      if (content.length > 0) {
        parts.push(`[Output Format]\n${content}`);
        activeBlockCount += 1;
      }
      continue;
    }

    if (block.kind === "constraint") {
      const content = interpolate((block.content ?? "").trim());
      if (content.length > 0) {
        parts.push(`[Constraint]\n${content}`);
        activeBlockCount += 1;
      }
      continue;
    }

    if (block.kind === "loop") {
      const variable = (block.variable ?? "").trim();
      const items = interpolate(block.items ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const bodyTemplate = block.content ?? "";
      if (variable.length > 0 && items.length > 0 && bodyTemplate.trim().length > 0) {
        const variablePattern = new RegExp(`\\{\\{${escapeRegExp(variable)}\\}\\}`, "g");
        for (const item of items) {
          parts.push(interpolate(bodyTemplate).replace(variablePattern, item));
        }
        activeBlockCount += 1;
      }
      continue;
    }

    if (block.kind === "conditional") {
      const variable = (block.variable ?? "").trim();
      const content = interpolate((block.content ?? "").trim());
      if (variable.length > 0 && content.length > 0 && (variables[variable] ?? "").trim().length > 0) {
        parts.push(content);
        activeBlockCount += 1;
      }
      continue;
    }

    if (block.kind === "metadata") {
      const key = (block.key ?? "").trim();
      const value = interpolate((block.value ?? "").trim());
      if (key.length > 0) {
        parts.push(`${key}: ${value}`);
        activeBlockCount += 1;
      }
      continue;
    }

    const content = interpolate((block.content ?? "").trim());
    if (content.length > 0) {
      parts.push(content);
      activeBlockCount += 1;
    }
  }

  const text = parts.join("\n\n");
  const tokenCount = text.trim().split(/\s+/).filter(Boolean).length;
  return {
    text,
    tokenCount,
    activeBlockCount,
  };
}

export function applyPromptWorkspaceBlocks(
  draft: PromptEditableDraft,
  blocks: PromptWorkspaceBlock[],
): PromptEditableDraft {
  const nextMessages: MessageDraft[] = [];
  let nextInputs: InputDraft[] = [];

  for (const block of blocks) {
    if (!block.enabled) {
      continue;
    }

    if (block.kind === "variables") {
      nextInputs = (block.entries ?? [])
        .map((entry) => ({
          name: entry.key.trim(),
          value: entry.value,
        }))
        .filter((entry) => entry.name.length > 0)
        .map((entry) => ({
          name: entry.name,
          type: "string" as const,
          required: false,
          description: "",
          defaultValue: JSON.stringify(entry.value),
        }));
      continue;
    }

    if (block.kind === "prompt") {
      nextMessages.push({
        role: "user",
        content: block.content ?? "",
      });
      continue;
    }

    if (block.kind === "context") {
      const label = block.label?.trim() ?? "";
      const body = block.content ?? "";
      nextMessages.push({
        role: block.role === "developer" ? "developer" : "system",
        content: label.length > 0 ? `[Context: ${label}]\n${body}`.trim() : body,
      });
      continue;
    }

    if (block.kind === "example") {
      nextMessages.push({
        role: "user",
        content: `Example input:\n${block.input ?? ""}`.trimEnd(),
      });
      nextMessages.push({
        role: "assistant",
        content: `Example output:\n${block.output ?? ""}`.trimEnd(),
      });
      continue;
    }

    if (block.kind === "output_format") {
      nextMessages.push({
        role: "developer",
        content: `Output format:\n${block.content ?? ""}`.trimEnd(),
      });
      continue;
    }

    if (block.kind === "constraint") {
      nextMessages.push({
        role: "developer",
        content: `Constraint:\n${block.content ?? ""}`.trimEnd(),
      });
      continue;
    }

    if (block.kind === "loop") {
      nextMessages.push({
        role: "developer",
        content: [`[Loop: ${block.variable ?? ""}]`, `Items: ${block.items ?? ""}`, block.content ?? ""]
          .join("\n")
          .trimEnd(),
      });
      continue;
    }

    if (block.kind === "conditional") {
      nextMessages.push({
        role: "developer",
        content: [`[Conditional: ${block.variable ?? ""}]`, block.content ?? ""].join("\n").trimEnd(),
      });
      continue;
    }

    if (block.kind === "metadata") {
      nextMessages.push({
        role: "developer",
        content: [`[Metadata: ${block.key ?? ""}]`, block.value ?? ""].join("\n").trimEnd(),
      });
      continue;
    }

    nextMessages.push({
      role:
        block.role === "system" || block.role === "developer" || block.role === "assistant" || block.role === "user"
          ? block.role
          : "developer",
      content: block.content ?? "",
    });
  }

  return {
    ...draft,
    messages: nextMessages,
    inputs: nextInputs,
  };
}

function mapAdditionalKindToToolName(kind: PromptDocumentAdditionalBlockKind): PromptDocumentEditorToolName {
  if (kind === "context") return "context";
  if (kind === "example_input") return "exampleInput";
  if (kind === "example_output") return "exampleOutput";
  if (kind === "output_format") return "outputFormat";
  if (kind === "constraint") return "constraint";
  return "generic";
}

export function createPromptDocumentEditorData(draft: PromptEditableDraft): OutputData {
  const model = createPromptDocumentModel(draft);
  const blocks: OutputBlockData<PromptDocumentEditorToolName, PromptDocumentEditorBlockData>[] = [];

  if (model.primaryInstructionIndex >= 0) {
    blocks.push({
      type: "promptInstruction",
      data: {
        kind: "prompt_instruction",
        content: draft.messages[model.primaryInstructionIndex]?.content ?? "",
        role: "user",
      },
    });
  }

  if (model.contextMessageIndex >= 0) {
    blocks.push({
      type: "context",
      data: {
        kind: "context",
        content: draft.messages[model.contextMessageIndex]?.content ?? "",
        role: draft.messages[model.contextMessageIndex]?.role ?? "system",
      },
    });
  }

  for (const block of model.additionalBlocks) {
    const message = draft.messages[block.index];
    blocks.push({
      type: mapAdditionalKindToToolName(block.kind),
      data: {
        kind: block.kind,
        content: message?.content ?? "",
        role: message?.role,
      },
    });
  }

  if (blocks.length === 0) {
    blocks.push({
      type: "promptInstruction",
      data: {
        kind: "prompt_instruction",
        content: "",
        role: "user",
      },
    });
  }

  return { blocks };
}

export function applyPromptDocumentEditorData(
  draft: PromptEditableDraft,
  output: Pick<OutputData, "blocks">,
): PromptEditableDraft {
  const nextMessages: MessageDraft[] = [];

  for (const block of output.blocks) {
    const data = (block.data ?? {}) as Partial<PromptDocumentEditorBlockData>;
    const content = typeof data.content === "string" ? data.content : "";

    if (block.type === "promptInstruction" || data.kind === "prompt_instruction") {
      nextMessages.push({ role: "user", content });
      continue;
    }

    if (block.type === "context" || data.kind === "context") {
      nextMessages.push({ role: data.role === "developer" ? "developer" : "system", content });
      continue;
    }

    if (block.type === "exampleInput" || data.kind === "example_input") {
      nextMessages.push({ role: "user", content });
      continue;
    }

    if (block.type === "exampleOutput" || data.kind === "example_output") {
      nextMessages.push({ role: "assistant", content });
      continue;
    }

    if (block.type === "outputFormat" || data.kind === "output_format") {
      nextMessages.push({ role: "developer", content });
      continue;
    }

    if (block.type === "constraint" || data.kind === "constraint") {
      nextMessages.push({ role: "developer", content });
      continue;
    }

    nextMessages.push({
      role:
        data.role === "system" || data.role === "developer" || data.role === "assistant" || data.role === "user"
          ? data.role
          : "developer",
      content,
    });
  }

  return {
    ...draft,
    messages: nextMessages,
  };
}
