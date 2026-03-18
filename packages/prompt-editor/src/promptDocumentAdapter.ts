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

export type GenericRoleOption = {
  name: string;
  description: string;
};

export type PromptWorkspaceBlock = {
  id: string;
  kind: PromptWorkspaceBlockKind;
  enabled: boolean;
  collapsed: boolean;
  role?: "system" | "developer" | "user" | "assistant";
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compilePromptWorkspaceBlocks(blocks: PromptWorkspaceBlock[], genericRoleOptions?: GenericRoleOption[]): PromptWorkspaceCompileResult {
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
      const roleName = (block.role ?? "").trim();
      const roleOption = genericRoleOptions?.find((r) => r.name === roleName);
      if (roleOption) {
        parts.push(`[Role: ${roleOption.description}]\n${content}`);
      } else {
        parts.push(content);
      }
      activeBlockCount += 1;
    }
  }

  const text = parts.join("\n\n");
  const tokenCount = text.trim().split(/\s+/).filter(Boolean).length;

  return { text, tokenCount, activeBlockCount };
}
