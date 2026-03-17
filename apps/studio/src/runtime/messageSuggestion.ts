import type { MessageTemplate, Prompt, PromptBlock } from "@promptfarm/core";

type MessageSuggestionPayload = {
  summary?: unknown;
  messages?: unknown;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractBalancedJsonDocument(text: string, startIndex: number): string {
  const openingChar = text[startIndex];
  const closingChar = openingChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === openingChar) {
      depth += 1;
      continue;
    }

    if (char === closingChar) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1).trim();
      }
    }
  }

  return text.slice(startIndex).trim();
}

function extractJsonDocument(text: string): string {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  const startIndex =
    objectStart === -1 ? arrayStart : arrayStart === -1 ? objectStart : Math.min(objectStart, arrayStart);
  if (startIndex === -1) {
    throw new Error("Message suggestion response did not contain JSON.");
  }

  return extractBalancedJsonDocument(text, startIndex);
}

function stripTrailingCommas(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    if (char === ",") {
      let lookahead = index + 1;
      while (lookahead < text.length && /\s/.test(text[lookahead] ?? "")) {
        lookahead += 1;
      }
      const nextChar = text[lookahead];
      if (nextChar === "}" || nextChar === "]") {
        continue;
      }
    }

    result += char;
  }

  return result;
}

function collapseDuplicateBraces(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    if ((char === "{" || char === "}") && nextChar === char) {
      result += char;
      index += 1;
      continue;
    }

    result += char;
  }

  return result;
}

function summarizeText(text: string, maxLength = 400): string {
  const normalized = text.trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function summarizeJsonParseError(document: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const positionMatch = message.match(/position\s+(\d+)/i);
  const position = positionMatch ? Number.parseInt(positionMatch[1] ?? "", 10) : Number.NaN;
  if (Number.isNaN(position)) {
    return `Document preview: ${summarizeText(document)}`;
  }

  const excerptStart = Math.max(0, position - 80);
  const excerptEnd = Math.min(document.length, position + 80);
  const excerpt = document.slice(excerptStart, excerptEnd);
  const pointer = " ".repeat(Math.max(0, position - excerptStart)) + "^";
  return `Near JSON position ${position}:\n${excerpt}\n${pointer}`;
}

function parsePayload(text: string): MessageSuggestionPayload {
  const jsonDocument = extractJsonDocument(text);
  const candidates = [
    jsonDocument,
    stripTrailingCommas(jsonDocument),
    collapseDuplicateBraces(jsonDocument),
    stripTrailingCommas(collapseDuplicateBraces(jsonDocument)),
  ].filter(
    (candidate, index, values) => candidate.length > 0 && values.indexOf(candidate) === index,
  );

  let parseError: unknown;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) {
        return { messages: parsed };
      }
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Message suggestion response must be a JSON object or array.");
      }
      return parsed as MessageSuggestionPayload;
    } catch (error) {
      parseError = error;
    }
  }

  throw new Error(`Message suggestion response contained invalid JSON. ${summarizeJsonParseError(jsonDocument, parseError)}`);
}

function extractTextValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => extractTextValue(item))
      .filter((item) => item.length > 0)
      .join("\n");
  }

  if (value && typeof value === "object") {
    const candidate = value as {
      text?: unknown;
      value?: unknown;
      content?: unknown;
    };

    if (typeof candidate.text === "string") {
      return candidate.text.trim();
    }
    if (typeof candidate.value === "string") {
      return candidate.value.trim();
    }
    if (candidate.content !== undefined) {
      return extractTextValue(candidate.content);
    }
  }

  return "";
}

function normalizeMessage(input: unknown, index: number): MessageTemplate {
  if (!input || typeof input !== "object") {
    throw new Error(`Suggested message ${index + 1} must be an object.`);
  }

  const candidate = input as { role?: unknown; content?: unknown };
  const role = asString(candidate.role) as MessageTemplate["role"];
  const content = extractTextValue(candidate.content);

  if (!["system", "developer", "user", "assistant"].includes(role)) {
    throw new Error(`Suggested message ${index + 1} used invalid role "${String(candidate.role ?? "")}".`);
  }
  if (!content) {
    throw new Error(`Suggested message ${index + 1} is missing content.`);
  }

  return { role, content };
}

function trimContext(text: string, maxLength = 1500): string {
  const normalized = text.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}\n\n[truncated]`;
}

export function createMessageSuggestionInputSignature(input: {
  entityKind: "prompt" | "block";
  artifactType: Prompt["spec"]["artifact"]["type"];
  title: string;
  description: string;
  promptSource?: string;
  variableNames?: string[];
  blockKind?: PromptBlock["kind"];
}): string {
  return JSON.stringify({
    entityKind: input.entityKind,
    artifactType: input.artifactType,
    title: input.title.trim(),
    description: input.description.trim(),
    promptSource: (input.promptSource ?? "").trim(),
    variableNames: [...(input.variableNames ?? [])].sort(),
    blockKind: input.blockKind ?? null,
  });
}

export function buildMessageSuggestionInstruction(input: {
  artifactType: Prompt["spec"]["artifact"]["type"];
  entityKind: "prompt" | "block";
  sourceMode?: "title_description" | "prompt_source";
  blockKind?: PromptBlock["kind"];
}): string {
  return [
    "Return only valid JSON.",
    input.sourceMode === "prompt_source"
      ? "You are reorganizing an existing PromptFarm prompt draft into stronger canonical messages."
      : "You are drafting canonical PromptFarm messages from title and description.",
    `Artifact type: ${input.artifactType}.`,
    `Target entity: ${input.entityKind}${input.blockKind ? ` (${input.blockKind})` : ""}.`,
    'Return an object with shape: {"summary":"...","messages":[{"role":"system","content":"..."},{"role":"user","content":"..."}]}.',
    "Return 2 to 5 messages total.",
    "At minimum include one system message and one user message.",
    "Messages must be directly usable as PromptFarm canonical messages.",
    input.sourceMode === "prompt_source"
      ? "Preserve the user's intent, variables, examples, and constraints, but reorganize them into clearer canonical messages."
      : "Infer the user's likely intent from the title and description.",
    "Do not include explanations outside JSON.",
  ].join("\n");
}

export function buildMessageSuggestionUserPrompt(input: {
  artifactType: Prompt["spec"]["artifact"]["type"];
  entityKind: "prompt" | "block";
  title: string;
  description: string;
  promptSource?: string;
  variableNames?: string[];
  blockKind?: PromptBlock["kind"];
}): string {
  const title = input.title.trim();
  const description = input.description.trim();
  const promptSource = (input.promptSource ?? "").trim();
  const variableNames = input.variableNames ?? [];

  return [
    promptSource
      ? `Reorganize this PromptFarm ${input.entityKind} draft into stronger canonical messages.`
      : `Draft canonical messages for a PromptFarm ${input.entityKind}.`,
    `Artifact type: ${input.artifactType}.`,
    input.blockKind ? `Block kind: ${input.blockKind}.` : null,
    title ? `Title: ${title}` : "Title: (empty)",
    description ? `Description: ${trimContext(description)}` : "Description: (empty)",
    variableNames.length > 0 ? `Variables: ${variableNames.join(", ")}` : "Variables: (none)",
    promptSource ? `Current prompt draft:\n${trimContext(promptSource, 2400)}` : null,
    promptSource
      ? "Preserve the meaning, but split the draft into stronger canonical messages."
      : "Infer the user's likely intent from the title and description.",
    "Make the system/developer messages set role, context, constraints, and output format. Make the user message state the concrete task.",
    "Keep the messages concise but production-usable.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");
}

export function parseMessageSuggestionResponse(text: string): {
  summary: string;
  messages: MessageTemplate[];
} {
  const payload = parsePayload(text);
  const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
  if (rawMessages.length === 0) {
    throw new Error("Message suggestion response did not include any messages.");
  }

  const messages = rawMessages.map((message, index) => normalizeMessage(message, index));
  const summary =
    asString(payload.summary) ||
    `Suggested ${messages.length} message${messages.length === 1 ? "" : "s"} (${messages.map((message) => message.role).join(", ")})`;

  return {
    summary,
    messages,
  };
}
