import { ArtifactType, PromptSchema, type Prompt } from "@promptfarm/core";
import {
  createPrimaryBuildTarget,
  findBuildTargetOption,
  getDefaultBuildTargetValue,
  getPrimaryBuildTarget,
  inferBuildTargetValue,
} from "../../model/artifactBuildTargets";
import {
  addPromptBlock,
  findPromptBlockById,
  movePromptBlock,
  relocatePromptBlock,
  reparentPromptBlock,
  removePromptBlock,
} from "../../model/promptTree";
import type { BlockEditIntent, GraphAddableNodeKind, GraphEditIntent, StudioFlowNode, StudioGraph } from "../types";

export type GraphSyncIssue = {
  nodeId?: string;
  message: string;
};

export type GraphToCanonicalSyncResult =
  | { supported: true; prompt: Prompt }
  | { supported: false; issues: GraphSyncIssue[] };

function formatLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function formatValidationIssue(path: (string | number)[], message: string): string {
  const hierarchyMatch = message.match(
    /^Block kind "([^"]+)" is not allowed under ([^ ]+) for artifact type "([^"]+)". Allowed children: (.+)\.$/,
  );

  if (hierarchyMatch) {
    const [, childKind, parentKind, artifactType, allowedChildren] = hierarchyMatch;
    const parentLabel = parentKind === "root" ? "the root level" : `a ${formatLabel(parentKind)}`;
    return `You can't place a ${formatLabel(childKind)} inside ${parentLabel} for ${formatLabel(artifactType)}. Allowed child types here: ${allowedChildren
      .split(",")
      .map((entry) => formatLabel(entry.trim()))
      .join(", ")}.`;
  }

  if (path.length === 0) {
    return message;
  }

  return `Invalid value at ${path.join(" > ")}: ${message}`;
}

function clonePrompt(prompt: Prompt): Prompt {
  return JSON.parse(JSON.stringify(prompt)) as Prompt;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function asOptionalString(value: unknown): string | undefined {
  const next = asString(value).trim();
  return next.length > 0 ? next : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const next = value.trim().toLowerCase();
    if (next === "true") return true;
    if (next === "false") return false;
  }
  return undefined;
}

function parseJsonValue(value: unknown): { ok: true; value: unknown | undefined } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== "string") return { ok: true, value };

  const next = value.trim();
  if (!next) return { ok: true, value: undefined };

  try {
    return { ok: true, value: JSON.parse(next) as unknown };
  } catch {
    return { ok: false };
  }
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => asString(entry).trim()).filter((entry) => entry.length > 0);
  }
  return asString(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseNodeIndex(node: StudioFlowNode): number | undefined {
  const raw = node.data.properties.__index;
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseNodeBlockId(node: StudioFlowNode): string | undefined {
  const raw = node.data.properties.__blockId;
  return raw && raw.length > 0 ? raw : undefined;
}

function findNode(graph: StudioGraph, nodeId: string): StudioFlowNode | undefined {
  return graph.nodes.find((node) => node.id === nodeId);
}

function syntheticPromptNodeId(prompt: Prompt): string {
  return `prompt:${prompt.metadata.id}`;
}

function uniqueIdentifier(base: string, existing: Set<string>): string {
  let index = 1;
  let candidate = `${base}_${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `${base}_${index}`;
  }
  return candidate;
}

function isArtifactType(value: string): value is Prompt["spec"]["artifact"]["type"] {
  return Object.values(ArtifactType).includes(value as ArtifactType);
}

function patchPromptNode(prompt: Prompt, changes: Record<string, unknown>): GraphSyncIssue[] {
  const issues: GraphSyncIssue[] = [];

  if (Object.prototype.hasOwnProperty.call(changes, "title")) {
    const next = asOptionalString(changes.title);
    if (next === undefined) {
      delete prompt.metadata.title;
    } else {
      prompt.metadata.title = next;
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "description")) {
    const next = asOptionalString(changes.description);
    if (next === undefined) {
      delete prompt.metadata.description;
    } else {
      prompt.metadata.description = next;
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "tags")) {
    prompt.metadata.tags = parseTags(changes.tags);
  }

  if (Object.prototype.hasOwnProperty.call(changes, "messages")) {
    if (!Array.isArray(changes.messages)) {
      issues.push({ message: "Prompt messages must be an array." });
    } else {
      prompt.spec.messages = changes.messages as Prompt["spec"]["messages"];
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "inputs")) {
    if (!Array.isArray(changes.inputs)) {
      issues.push({ message: "Prompt inputs must be an array." });
    } else {
      prompt.spec.inputs = changes.inputs as Prompt["spec"]["inputs"];
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "evaluation")) {
    const next = changes.evaluation;
    if (next === undefined || next === null) {
      delete prompt.spec.evaluation;
    } else if (typeof next === "object" && !Array.isArray(next)) {
      prompt.spec.evaluation = next as NonNullable<Prompt["spec"]["evaluation"]>;
    } else {
      issues.push({ message: "Prompt evaluation must be an object or unset." });
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "artifactType") || Object.prototype.hasOwnProperty.call(changes, "buildTarget")) {
    issues.push(...patchArtifactNode(prompt, changes));
  }

  return issues;
}

function patchBlockNode(prompt: Prompt, blockId: string, changes: Record<string, unknown>): GraphSyncIssue[] {
  const block = findPromptBlockById(prompt.spec.blocks, blockId);
  if (!block) {
    return [{ nodeId: blockId, message: `Prompt block ${blockId} was not found.` }];
  }

  const issues: GraphSyncIssue[] = [];

  if (Object.prototype.hasOwnProperty.call(changes, "title")) {
    block.title = asString(changes.title).trim();
  }
  if (Object.prototype.hasOwnProperty.call(changes, "description")) {
    const next = asOptionalString(changes.description);
    if (next === undefined) {
      delete block.description;
    } else {
      block.description = next;
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, "blockKind")) {
    block.kind = asString(changes.blockKind).trim() as typeof block.kind;
  }

  if (Object.prototype.hasOwnProperty.call(changes, "messages")) {
    if (!Array.isArray(changes.messages)) {
      issues.push({ nodeId: blockId, message: "Block messages must be an array." });
    } else {
      block.messages = changes.messages as typeof block.messages;
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "inputs")) {
    if (!Array.isArray(changes.inputs)) {
      issues.push({ nodeId: blockId, message: "Block inputs must be an array." });
    } else {
      block.inputs = changes.inputs as typeof block.inputs;
    }
  }

  return issues;
}

function patchArtifactNode(prompt: Prompt, changes: Record<string, unknown>): GraphSyncIssue[] {
  const artifactTypeChanged = Object.prototype.hasOwnProperty.call(changes, "artifactType");
  const buildTargetChanged = Object.prototype.hasOwnProperty.call(changes, "buildTarget");

  if (!artifactTypeChanged && !buildTargetChanged) {
    return [];
  }

  const nextArtifactType = artifactTypeChanged
    ? (asString(changes.artifactType).trim() as Prompt["spec"]["artifact"]["type"])
    : prompt.spec.artifact.type;
  if (!isArtifactType(nextArtifactType)) {
    return [{ message: `Unsupported artifact type: ${nextArtifactType || "(empty)"}.` }];
  }

  const primaryBuildTarget = getPrimaryBuildTarget(prompt);
  const nextBuildTargetValue = buildTargetChanged
    ? asString(changes.buildTarget).trim()
    : artifactTypeChanged
      ? getDefaultBuildTargetValue(nextArtifactType)
      : inferBuildTargetValue(nextArtifactType, primaryBuildTarget);
  if (buildTargetChanged && !findBuildTargetOption(nextArtifactType, nextBuildTargetValue)) {
    return [{ message: `Unsupported build target ${nextBuildTargetValue || "(empty)"} for artifact type ${nextArtifactType}.` }];
  }

  prompt.spec.artifact.type = nextArtifactType;

  const nextPrimary = createPrimaryBuildTarget(nextArtifactType, nextBuildTargetValue, primaryBuildTarget);
  if (prompt.spec.buildTargets.length > 0) {
    prompt.spec.buildTargets[0] = nextPrimary;
  } else {
    prompt.spec.buildTargets.push(nextPrimary);
  }

  return [];
}

function patchInputNode(prompt: Prompt, node: StudioFlowNode, changes: Record<string, unknown>): GraphSyncIssue[] {
  const index = parseNodeIndex(node);
  const blockId = parseNodeBlockId(node);
  const scopedInputs = blockId ? findPromptBlockById(prompt.spec.blocks, blockId)?.inputs : prompt.spec.inputs;

  if (index === undefined || !scopedInputs?.[index]) {
    return [{ nodeId: node.id, message: "Input node is not mapped to canonical input index." }];
  }

  const target = scopedInputs[index]!;
  const issues: GraphSyncIssue[] = [];

  if (Object.prototype.hasOwnProperty.call(changes, "name")) {
    target.name = asString(changes.name).trim();
  }
  if (Object.prototype.hasOwnProperty.call(changes, "type")) {
    target.type = asString(changes.type).trim() as typeof target.type;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "required")) {
    const parsed = asBoolean(changes.required);
    if (parsed === undefined) {
      issues.push({ nodeId: node.id, message: "Input required must be boolean." });
    } else {
      target.required = parsed;
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, "description")) {
    const next = asOptionalString(changes.description);
    if (next === undefined) {
      delete target.description;
    } else {
      target.description = next;
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, "default")) {
    const parsed = parseJsonValue(changes.default);
    if (!parsed.ok) {
      issues.push({ nodeId: node.id, message: "Input default must be valid JSON value." });
    } else if (parsed.value === undefined) {
      delete target.default;
    } else {
      target.default = parsed.value;
    }
  }

  return issues;
}

function patchMessageNode(prompt: Prompt, node: StudioFlowNode, changes: Record<string, unknown>): GraphSyncIssue[] {
  const index = parseNodeIndex(node);
  const blockId = parseNodeBlockId(node);
  const scopedMessages = blockId ? findPromptBlockById(prompt.spec.blocks, blockId)?.messages : prompt.spec.messages;
  if (index === undefined || !scopedMessages?.[index]) {
    return [{ nodeId: node.id, message: "Message node is not mapped to canonical message index." }];
  }

  const target = scopedMessages[index]!;
  if (Object.prototype.hasOwnProperty.call(changes, "role")) {
    target.role = asString(changes.role).trim() as typeof target.role;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "content")) {
    target.content = asString(changes.content);
  }

  return [];
}

function patchUsePromptNode(prompt: Prompt, node: StudioFlowNode, changes: Record<string, unknown>): GraphSyncIssue[] {
  const index = parseNodeIndex(node);
  if (index === undefined || !prompt.spec.use[index]) {
    return [{ nodeId: node.id, message: "Use Prompt node is not mapped to canonical dependency index." }];
  }

  const target = prompt.spec.use[index]!;

  if (Object.prototype.hasOwnProperty.call(changes, "prompt")) {
    target.prompt = asString(changes.prompt).trim();
  }
  if (Object.prototype.hasOwnProperty.call(changes, "mode")) {
    const next = asOptionalString(changes.mode);
    if (next === undefined) {
      delete target.mode;
    } else {
      target.mode = next as typeof target.mode;
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, "version")) {
    const next = asOptionalString(changes.version);
    if (next === undefined) {
      delete target.version;
    } else {
      target.version = next;
    }
  }

  return [];
}

function patchNode(prompt: Prompt, graph: StudioGraph, intent: Extract<GraphEditIntent, { type: "node.patch" }>): GraphSyncIssue[] {
  const node = findNode(graph, intent.nodeId);
  if (!node && intent.nodeId === syntheticPromptNodeId(prompt)) {
    return patchPromptNode(prompt, intent.changes);
  }
  if (!node) {
    return [{ nodeId: intent.nodeId, message: "Graph node for patch intent was not found." }];
  }

  switch (node.data.kind) {
    case "prompt":
      return patchPromptNode(prompt, intent.changes);
    case "block": {
      const blockId = parseNodeBlockId(node) ?? node.data.properties.blockId;
      if (!blockId) {
        return [{ nodeId: node.id, message: "Block node is missing canonical block id." }];
      }
      return patchBlockNode(prompt, blockId, intent.changes);
    }
    case "artifact":
      return patchArtifactNode(prompt, intent.changes);
    case "input":
      return patchInputNode(prompt, node, intent.changes);
    case "message":
      return patchMessageNode(prompt, node, intent.changes);
    case "use_prompt":
      return patchUsePromptNode(prompt, node, intent.changes);
    case "evaluation":
      return [{ nodeId: node.id, message: "Evaluation node is read-only in the current Studio scope." }];
    default:
      return [{ nodeId: node.id, message: `Unsupported node kind: ${String(node.data.kind)}` }];
  }
}

function addNode(prompt: Prompt, kind: GraphAddableNodeKind, targetBlockId?: string | null): GraphSyncIssue[] {
  const targetBlock = targetBlockId ? findPromptBlockById(prompt.spec.blocks, targetBlockId) : undefined;

  if (kind === "input") {
    const scopedInputs: Prompt["spec"]["inputs"] = targetBlock ? targetBlock.inputs : prompt.spec.inputs;
    const existing = new Set(scopedInputs.map((input) => input.name));
    scopedInputs.push({
      name: uniqueIdentifier("input", existing),
      type: "string",
      required: false,
    });
    return [];
  }

  if (kind === "message") {
    const scopedMessages: Prompt["spec"]["messages"] = targetBlock ? targetBlock.messages : prompt.spec.messages;
    scopedMessages.push({
      role: "user",
      content: "New message",
    });
    return [];
  }

  if (kind === "use_prompt") {
    if (targetBlockId) {
      return [{ message: "Use Prompt remains root-only in the current Prompt Tree scope." }];
    }
    const existing = new Set(prompt.spec.use.map((dep) => dep.prompt));
    prompt.spec.use.push({
      prompt: uniqueIdentifier("dependency", existing),
      mode: "inline",
    });
    return [];
  }

  return [];
}

function removeNode(prompt: Prompt, graph: StudioGraph, intent: Extract<GraphEditIntent, { type: "node.remove" }>): GraphSyncIssue[] {
  const node = findNode(graph, intent.nodeId);
  if (!node) {
    return [{ nodeId: intent.nodeId, message: "Graph node for remove intent was not found." }];
  }

  const index = parseNodeIndex(node);
  const blockId = parseNodeBlockId(node);

  if (node.data.kind === "input") {
    const scopedInputs = blockId ? findPromptBlockById(prompt.spec.blocks, blockId)?.inputs : prompt.spec.inputs;
    if (index === undefined || !scopedInputs?.[index]) {
      return [{ nodeId: node.id, message: "Input node is not mapped to canonical input index." }];
    }
    scopedInputs.splice(index, 1);
    return [];
  }

  if (node.data.kind === "message") {
    const scopedMessages = blockId ? findPromptBlockById(prompt.spec.blocks, blockId)?.messages : prompt.spec.messages;
    if (index === undefined || !scopedMessages?.[index]) {
      return [{ nodeId: node.id, message: "Message node is not mapped to canonical message index." }];
    }
    scopedMessages.splice(index, 1);
    return [];
  }

  if (node.data.kind === "use_prompt") {
    if (index === undefined || !prompt.spec.use[index]) {
      return [{ nodeId: node.id, message: "Use Prompt node is not mapped to canonical dependency index." }];
    }
    prompt.spec.use.splice(index, 1);
    return [];
  }

  return [{ nodeId: node.id, message: `${node.data.kind} node cannot be removed in the current Studio scope.` }];
}

function applyBlockIntent(prompt: Prompt, intent: BlockEditIntent): GraphSyncIssue[] {
  if (intent.type === "block.add") {
    try {
      addPromptBlock(prompt, intent.kind, intent.parentBlockId);
      return [];
    } catch (error) {
      return [{ message: error instanceof Error ? error.message : String(error) }];
    }
  }

  if (intent.type === "block.patch") {
    return patchBlockNode(prompt, intent.blockId, intent.changes);
  }

  if (intent.type === "block.remove") {
    return removePromptBlock(prompt, intent.blockId)
      ? []
      : [{ nodeId: intent.blockId, message: `Prompt block ${intent.blockId} was not found.` }];
  }

  if (intent.type === "block.move") {
    return movePromptBlock(prompt, intent.blockId, intent.direction)
      ? []
      : [{ nodeId: intent.blockId, message: `Prompt block ${intent.blockId} cannot move ${intent.direction}.` }];
  }

  if (intent.type === "block.relocate") {
    return relocatePromptBlock(prompt, intent.blockId, intent.targetParentId, intent.targetIndex)
      ? []
      : [{ nodeId: intent.blockId, message: `Prompt block ${intent.blockId} cannot relocate.` }];
  }

  if (intent.type === "block.reparent") {
    return reparentPromptBlock(prompt, intent.blockId, intent.targetBlockId)
      ? []
      : [{ nodeId: intent.blockId, message: `Prompt block ${intent.blockId} cannot move into ${intent.targetBlockId ?? "root"}.` }];
  }

  return [];
}

function validatePrompt(prompt: Prompt): GraphToCanonicalSyncResult {
  const validated = PromptSchema.safeParse(prompt);
  if (!validated.success) {
    return {
      supported: false,
      issues: validated.error.issues.map((issue) => ({
        message: formatValidationIssue(issue.path, issue.message),
      })),
    };
  }

  return {
    supported: true,
    prompt: validated.data,
  };
}

export function applyGraphIntentToPrompt(
  prompt: Prompt,
  graph: StudioGraph,
  intent: GraphEditIntent | BlockEditIntent,
): GraphToCanonicalSyncResult {
  const nextPrompt = clonePrompt(prompt);

  let issues: GraphSyncIssue[] = [];

  if (intent.type === "node.patch") {
    issues = patchNode(nextPrompt, graph, intent);
  } else if (intent.type === "node.add") {
    issues = addNode(nextPrompt, intent.kind, intent.targetBlockId);
  } else if (intent.type === "node.remove") {
    issues = removeNode(nextPrompt, graph, intent);
  } else {
    issues = applyBlockIntent(nextPrompt, intent);
  }

  if (issues.length > 0) {
    return {
      supported: false,
      issues,
    };
  }

  return validatePrompt(nextPrompt);
}

// Transitional compatibility entrypoint.
// Graph-only reconstruction is intentionally unsupported: we only patch existing canonical prompts.
export function graphToCanonicalPrompt(_graph: StudioGraph): GraphToCanonicalSyncResult {
  return {
    supported: false,
    issues: [{ message: "graph-to-canonical reconstruction is disabled; use intent-based patching" }],
  };
}
