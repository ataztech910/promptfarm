import {
  getAllowedPromptBlockKinds,
  isAllowedPromptBlockKind,
  type Prompt,
  type PromptBlockKind,
} from "@promptfarm/core";
import type { StudioGraphProposal, StudioGraphProposalBlock, StudioScopeDescriptor } from "../graph/types";
import { findPromptBlockById } from "../model/promptTree";

type GraphProposalPayload = {
  summary?: unknown;
  blocks?: unknown;
  block?: unknown;
  chapters?: unknown;
  chapter?: unknown;
  sections?: unknown;
  section?: unknown;
  items?: unknown;
  item?: unknown;
  nodes?: unknown;
  node?: unknown;
  outline?: unknown;
  structure?: unknown;
};

type RawGraphProposalBlock = {
  kind?: unknown;
  title?: unknown;
  description?: unknown;
  instruction?: unknown;
  prompt?: unknown;
  text?: unknown;
  content?: unknown;
  children?: unknown;
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
    throw new Error("Graph proposal response did not contain JSON.");
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

function closeTruncatedJsonDocument(text: string): string {
  const closers: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
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

    if (char === "{") {
      closers.push("}");
      continue;
    }

    if (char === "[") {
      closers.push("]");
      continue;
    }

    if ((char === "}" || char === "]") && closers.length > 0) {
      closers.pop();
    }
  }

  let repaired = text;
  if (inString) {
    if (escaped) {
      repaired += "\\";
    }
    repaired += '"';
  }

  if (closers.length > 0) {
    repaired += closers.reverse().join("");
  }

  return repaired;
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

function summarizeUnknown(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized.length <= 1200 ? serialized : `${serialized.slice(0, 1200)}...`;
  } catch {
    return String(value);
  }
}

function parseJsonStringLiteral(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function recoverPartialProposalPayload(document: string): GraphProposalPayload | null {
  const summaryMatch = document.match(/"summary"\s*:\s*"((?:\\.|[^"])*)"/);
  const recoveredSummary = summaryMatch?.[1] ? parseJsonStringLiteral(summaryMatch[1]) : "";

  const listKeyMatch = document.match(/"(blocks|block|chapters|chapter|sections|section|items|item|nodes|node|outline|structure)"\s*:\s*\[/);
  if (!listKeyMatch || listKeyMatch.index === undefined) {
    return null;
  }

  const listKey = listKeyMatch[1] as keyof GraphProposalPayload;
  const arrayStart = document.indexOf("[", listKeyMatch.index);
  if (arrayStart === -1) {
    return null;
  }

  const arraySlice = document.slice(arrayStart);
  const recoveredItems: unknown[] = [];

  let index = 0;
  while (index < arraySlice.length) {
    const objectStart = arraySlice.indexOf("{", index);
    if (objectStart === -1) {
      break;
    }

    const candidate = extractBalancedJsonDocument(arraySlice, objectStart);
    const trimmedCandidate = candidate.trim();
    if (!trimmedCandidate.startsWith("{") || !trimmedCandidate.endsWith("}")) {
      break;
    }

    try {
      recoveredItems.push(JSON.parse(trimmedCandidate) as unknown);
      index = objectStart + candidate.length;
    } catch {
      index = objectStart + 1;
    }
  }

  if (recoveredItems.length === 0) {
    return null;
  }

  return {
    ...(recoveredSummary ? { summary: recoveredSummary } : {}),
    [listKey]: recoveredItems,
  };
}

function parseProposalPayload(text: string): GraphProposalPayload {
  const jsonDocument = extractJsonDocument(text);

  const repairedDocument = closeTruncatedJsonDocument(jsonDocument);
  const candidates = [
    jsonDocument,
    stripTrailingCommas(jsonDocument),
    repairedDocument,
    stripTrailingCommas(repairedDocument),
  ].filter(
    (candidate, index, values) => candidate.length > 0 && values.indexOf(candidate) === index,
  );

  let parseError: unknown;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) {
        return { blocks: parsed };
      }
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Graph proposal response must be a JSON object or array.");
      }
      return parsed as GraphProposalPayload;
    } catch (error) {
      parseError = error;
    }
  }

  const recoveredPayload = recoverPartialProposalPayload(jsonDocument);
  if (recoveredPayload) {
    return recoveredPayload;
  }

  throw new Error(
    `Graph proposal response contained invalid JSON. ${summarizeJsonParseError(jsonDocument, parseError)}`,
  );
}

function extractProposalBlockList(payload: GraphProposalPayload): unknown[] {
  const rootPayload = payload as Record<string, unknown>;
  const candidates = [
    rootPayload,
    payload.blocks,
    payload.block,
    payload.chapters,
    payload.chapter,
    payload.sections,
    payload.section,
    payload.items,
    payload.item,
    payload.nodes,
    payload.node,
    payload.outline,
    payload.structure,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }

    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      const nestedList = [
        nested.blocks,
        nested.block,
        nested.chapters,
        nested.chapter,
        nested.sections,
        nested.section,
        nested.items,
        nested.item,
        nested.nodes,
        nested.node,
        nested.children,
        nested.outline,
        nested.structure,
        (nested.user as Record<string, unknown> | undefined)?.children,
        (nested.user as Record<string, unknown> | undefined)?.blocks,
        (nested.user as Record<string, unknown> | undefined)?.block,
        (nested.user as Record<string, unknown> | undefined)?.chapters,
        (nested.user as Record<string, unknown> | undefined)?.chapter,
        (nested.system as Record<string, unknown> | undefined)?.children,
        (nested.system as Record<string, unknown> | undefined)?.blocks,
        (nested.system as Record<string, unknown> | undefined)?.block,
        (nested.system as Record<string, unknown> | undefined)?.chapters,
        (nested.system as Record<string, unknown> | undefined)?.chapter,
      ].find((value) => Array.isArray(value));
      if (Array.isArray(nestedList)) {
        return nestedList;
      }
    }
  }

  return [];
}

function normalizeRequestedKind(input: {
  requestedKind: string;
  artifactType: Prompt["spec"]["artifact"]["type"];
  parentKind: PromptBlockKind | null;
}): PromptBlockKind | "" {
  const requestedKind = input.requestedKind.trim().toLowerCase();
  if (!requestedKind) {
    return "";
  }

  const allowedKinds = getAllowedPromptBlockKinds(input.artifactType, input.parentKind);
  if (isAllowedPromptBlockKind(input.artifactType, requestedKind as PromptBlockKind, input.parentKind)) {
    return requestedKind as PromptBlockKind;
  }

  if (input.artifactType === "book_text") {
    if (requestedKind === "block") {
      if (allowedKinds.includes("section")) {
        return "section";
      }
      if (allowedKinds.includes("chapter")) {
        return "chapter";
      }
    }

    if (requestedKind === "book_text" && allowedKinds.includes("chapter")) {
      return "chapter";
    }

    if (
      ["heading", "subheading", "subsection", "chapter_section", "topic", "paragraph", "text", "bullet", "list_item", "quote", "note"].includes(requestedKind) &&
      allowedKinds.includes("section")
    ) {
      return "section";
    }

    if (requestedKind === "chapter" && allowedKinds.includes("section")) {
      return "section";
    }

    if (["part", "chapter_outline", "chapter_heading"].includes(requestedKind) && allowedKinds.includes("chapter")) {
      return "chapter";
    }
  }

  return requestedKind as PromptBlockKind;
}

function isLikelyStructuralChild(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.kind === "string" ||
    typeof candidate.title === "string" ||
    typeof candidate.description === "string" ||
    typeof candidate.instruction === "string" ||
    typeof candidate.prompt === "string" ||
    Array.isArray(candidate.children)
  );
}

function deriveProposalBlockTitle(raw: RawGraphProposalBlock): string {
  const explicitTitle = asString(raw.title);
  if (explicitTitle) {
    return explicitTitle;
  }

  const fallbackSource =
    asString(raw.description) ||
    asString(raw.instruction) ||
    asString(raw.prompt) ||
    asString(raw.text) ||
    asString(raw.content);
  if (!fallbackSource) {
    return "";
  }

  const normalized = fallbackSource.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  return normalized.length > 72 ? `${normalized.slice(0, 69).trimEnd()}...` : normalized;
}

function normalizeProposalBlock(input: {
  raw: RawGraphProposalBlock;
  artifactType: Prompt["spec"]["artifact"]["type"];
  parentKind: PromptBlockKind | null;
  idPrefix: string;
  path: number[];
}): StudioGraphProposalBlock {
  const allowedKinds = getAllowedPromptBlockKinds(input.artifactType, input.parentKind);
  const kind = normalizeRequestedKind({
    requestedKind: asString(input.raw.kind),
    artifactType: input.artifactType,
    parentKind: input.parentKind,
  }) || (allowedKinds.length === 1 ? allowedKinds[0]! : "");
  if (!kind) {
    throw new Error(`Graph proposal block ${input.path.join(".") || "root"} is missing kind.`);
  }

  if (!isAllowedPromptBlockKind(input.artifactType, kind, input.parentKind)) {
    throw new Error(
      `Graph proposal block ${input.path.join(".") || "root"} used invalid kind "${kind}" under ${input.parentKind ?? "root"}. Allowed: ${allowedKinds.join(", ") || "(none)"}.`,
    );
  }

  const title = deriveProposalBlockTitle(input.raw);
  if (!title) {
    throw new Error(`Graph proposal block ${input.path.join(".") || "root"} is missing title.`);
  }

  const description = asString(input.raw.description);
  const instruction = asString(input.raw.instruction) || asString(input.raw.prompt) || description || `Draft ${title}.`;
  const proposalNodeId = `${input.idPrefix}_${input.path.join("_") || "0"}`;
  const rawChildren = Array.isArray(input.raw.children) ? input.raw.children.filter(isLikelyStructuralChild) : [];

  const children = rawChildren.map((child, index) =>
    normalizeProposalBlock({
      raw: (child ?? {}) as RawGraphProposalBlock,
      artifactType: input.artifactType,
      parentKind: kind,
      idPrefix: input.idPrefix,
      path: [...input.path, index],
    }),
  );

  return {
    proposalNodeId,
    parentProposalNodeId: input.path.length > 1 ? `${input.idPrefix}_${input.path.slice(0, -1).join("_")}` : null,
    kind,
    title,
    description,
    instruction,
    children,
  };
}

function flattenTitles(blocks: StudioGraphProposalBlock[]): string[] {
  return blocks.flatMap((block) => [block.title, ...flattenTitles(block.children)]);
}

function inferGraphProposalWarnings(input: {
  prompt: Prompt;
  scope: StudioScopeDescriptor;
  parentKind: PromptBlockKind | null;
  blocks: StudioGraphProposalBlock[];
}): string[] {
  const warnings: string[] = [];
  const artifactType = input.prompt.spec.artifact.type;
  const topLevelTitles = input.blocks.map((block) => block.title.trim()).filter((title) => title.length > 0);
  const metaTitlePattern = /\b(genre|audience|tone|style|voice|goal|goals|reader|readers|market)\b/i;

  if (artifactType === "book_text" && input.scope.mode === "root") {
    if (input.blocks.length < 4) {
      warnings.push("The outline is shallow for a book root. Consider regenerating for a fuller chapter structure.");
    }

    if (topLevelTitles.some((title) => metaTitlePattern.test(title))) {
      warnings.push("Some proposed top-level blocks look like metadata rather than real chapters.");
    }
  }

  if (artifactType === "book_text" && input.parentKind === "chapter" && input.blocks.length < 2) {
    warnings.push("This chapter proposal is sparse. Consider regenerating for a richer section breakdown.");
  }

  return [...new Set(warnings)];
}

function trimContext(text: string, maxLength = 4000): string {
  const normalized = text.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}\n\n[truncated]`;
}

function buildArtifactSpecificProposalGuidance(input: {
  prompt: Prompt;
  scope: StudioScopeDescriptor;
  allowedKinds: PromptBlockKind[];
}): string[] {
  if (input.prompt.spec.artifact.type !== "book_text") {
    return [];
  }

  if (input.scope.mode === "root") {
    return [
      "For book_text at the root, prefer a table-of-contents style proposal made of chapter blocks.",
      "Prefer a stronger first-pass outline with roughly 5 to 8 chapters unless the prompt clearly asks for a very short booklet.",
      "Chapter titles should describe substantive content, not metadata labels.",
      "Do not create blocks such as genre, audience, tone, or goals unless the user explicitly asked for metadata nodes.",
      "Audience, genre, and tone should shape the chapter plan rather than appear as standalone child blocks.",
    ];
  }

  if (input.allowedKinds.includes("section")) {
    return [
      "For book_text inside a chapter, prefer section blocks that break the chapter into content subsections.",
      "Prefer a richer chapter breakdown with roughly 3 to 6 sections when the material supports it.",
      "Do not use metadata categories as child blocks unless the user explicitly asked for that structure.",
    ];
  }

  return [];
}

function buildProposalCountGuidance(input: {
  prompt: Prompt;
  scope: StudioScopeDescriptor;
  allowedKinds: PromptBlockKind[];
}): string {
  if (input.prompt.spec.artifact.type === "book_text" && input.scope.mode === "root") {
    return "Return roughly 5 to 8 direct child blocks unless the prompt clearly asks for a shorter book.";
  }

  if (input.prompt.spec.artifact.type === "book_text" && input.allowedKinds.includes("section")) {
    return "Return roughly 3 to 6 direct child blocks when the chapter material supports it.";
  }

  return "Return 1 to 3 useful direct child blocks unless this scope truly cannot accept children.";
}

export function buildGraphProposalInstruction(input: {
  prompt: Prompt;
  scope: StudioScopeDescriptor;
}): string {
  const parentKind =
    input.scope.mode === "block" && input.scope.blockId
      ? findPromptBlockById(input.prompt.spec.blocks, input.scope.blockId)?.kind ?? null
      : null;
  const allowedKinds = getAllowedPromptBlockKinds(input.prompt.spec.artifact.type, parentKind);
  const artifactSpecificGuidance = buildArtifactSpecificProposalGuidance({
    prompt: input.prompt,
    scope: input.scope,
    allowedKinds,
  });
  const proposalCountGuidance = buildProposalCountGuidance({
    prompt: input.prompt,
    scope: input.scope,
    allowedKinds,
  });

  return [
    "Return only valid JSON.",
    "You are proposing new prompt blocks for PromptFarm Studio.",
    `Artifact type: ${input.prompt.spec.artifact.type}.`,
    `Target scope: ${input.scope.label}.`,
    `Allowed direct child block kinds here: ${allowedKinds.join(", ") || "(none)"}.`,
    'Return an object with shape: {"summary":"...","blocks":[{"kind":"...","title":"...","description":"...","instruction":"...","children":[...]}]}.',
    proposalCountGuidance,
    "Prefer the strongest useful outline you can infer, not the smallest valid structure.",
    "Each child must obey PromptFarm block hierarchy rules for the artifact type.",
    "If the source prompt is brief, infer a sensible minimal structure instead of returning an empty response.",
    "Titles should be concrete and production-usable, not placeholders.",
    ...artifactSpecificGuidance,
    "Do not include explanations outside JSON.",
  ].join("\n");
}

export function buildGraphProposalUserPrompt(input: {
  prompt: Prompt;
  scope: StudioScopeDescriptor;
  renderedPromptText?: string | null;
}): string {
  const promptTitle = input.prompt.metadata.title?.trim() || input.prompt.metadata.id;
  const promptDescription = input.prompt.metadata.description?.trim() || "";
  const scopeContext = input.renderedPromptText?.trim()
    ? trimContext(input.renderedPromptText)
    : [promptTitle, promptDescription].filter((value) => value.length > 0).join("\n");
  const allowedKinds = getAllowedPromptBlockKinds(
    input.prompt.spec.artifact.type,
    input.scope.mode === "block" && input.scope.blockId
      ? findPromptBlockById(input.prompt.spec.blocks, input.scope.blockId)?.kind ?? null
      : null,
  );
  const artifactSpecificGuidance = buildArtifactSpecificProposalGuidance({
    prompt: input.prompt,
    scope: input.scope,
    allowedKinds,
  });
  const proposalCountGuidance = buildProposalCountGuidance({
    prompt: input.prompt,
    scope: input.scope,
    allowedKinds,
  });

  return [
    `Generate a JSON-only structure proposal for "${promptTitle}" at scope "${input.scope.label}".`,
    proposalCountGuidance,
    "Each block must include kind, title, description, instruction, and children.",
    "Do not return markdown. Do not explain your choices. Output JSON only.",
    ...artifactSpecificGuidance,
    scopeContext
      ? `Use this prompt context when deciding the structure:\n${scopeContext}`
      : "The source prompt is minimal. Infer a sensible starter structure from the artifact type and scope.",
  ].join("\n\n");
}

export function createGraphProposalFromResponse(input: {
  prompt: Prompt;
  scope: StudioScopeDescriptor;
  sourceNodeId: string;
  sourceRuntimeNodeId: string;
  proposalId: string;
  executionId: string;
  responseText: string;
}): StudioGraphProposal {
  const payload = parseProposalPayload(input.responseText);
  const rawBlocks = extractProposalBlockList(payload);
  if (rawBlocks.length === 0) {
    throw new Error(`Graph proposal response did not include any blocks. Payload preview: ${summarizeUnknown(payload)}`);
  }

  const parentKind =
    input.scope.mode === "block" && input.scope.blockId
      ? findPromptBlockById(input.prompt.spec.blocks, input.scope.blockId)?.kind ?? null
      : null;

  const blocks = rawBlocks.map((rawBlock, index) =>
    normalizeProposalBlock({
      raw: (rawBlock ?? {}) as RawGraphProposalBlock,
      artifactType: input.prompt.spec.artifact.type,
      parentKind,
      idPrefix: input.proposalId,
      path: [index],
    }),
  );

  const summary = asString(payload.summary) || `Proposed ${flattenTitles(blocks).length} block(s): ${flattenTitles(blocks).join(", ")}`;
  const warnings = inferGraphProposalWarnings({
    prompt: input.prompt,
    scope: input.scope,
    parentKind,
    blocks,
  });

  return {
    proposalId: input.proposalId,
    sourceNodeId: input.sourceNodeId,
    sourceRuntimeNodeId: input.sourceRuntimeNodeId,
    scope: input.scope,
    executionId: input.executionId,
    status: "preview",
    summary,
    ...(warnings.length > 0 ? { warnings } : {}),
    blocks,
    createdAt: Date.now(),
  };
}
