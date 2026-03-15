import type { InputDefinition, MessageTemplate, Prompt, PromptBlock } from "@promptfarm/core";
import { findPromptBlockById } from "../model/promptTree";
import type { StudioFlowNode } from "../graph/types";

export type MessageDraft = {
  role: MessageTemplate["role"];
  content: string;
};

export type InputDraft = {
  name: string;
  type: InputDefinition["type"];
  required: boolean;
  description: string;
  defaultValue: string;
};

export type RootDraft = {
  entityKind: "prompt";
  title: string;
  description: string;
  tags: string;
  artifactType: Prompt["spec"]["artifact"]["type"];
  buildTarget: string;
  messages: MessageDraft[];
  inputs: InputDraft[];
  evaluationEnabled: boolean;
  reviewerRolesJson: string;
  criteriaJson: string;
  qualityGatesJson: string;
};

export type BlockDraft = {
  entityKind: "block";
  blockId: string;
  blockKind: PromptBlock["kind"];
  title: string;
  description: string;
  messages: MessageDraft[];
  inputs: InputDraft[];
};

export type UsePromptDraft = {
  entityKind: "use_prompt";
  prompt: string;
  mode: string;
  version: string;
};

export type EditorDraft = RootDraft | BlockDraft | UsePromptDraft;

export type EditorSelection =
  | { kind: "prompt"; ref: string; promptNodeId: string; prompt: Prompt }
  | { kind: "block"; ref: string; promptNodeId: string; prompt: Prompt; block: PromptBlock }
  | { kind: "use_prompt"; ref: string; prompt: Prompt; nodeId: string; index: number };

export type EditorDraftSession = {
  ref: string;
  entityKind: EditorDraft["entityKind"];
  draft: EditorDraft;
  dirty: boolean;
  validationError: string | null;
  lastSyncedCanonicalHash: string;
};

function toMessageDrafts(messages: MessageTemplate[]): MessageDraft[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function toInputDrafts(inputs: InputDefinition[]): InputDraft[] {
  return inputs.map((input) => ({
    name: input.name,
    type: input.type,
    required: input.required,
    description: input.description ?? "",
    defaultValue: input.default === undefined ? "" : JSON.stringify(input.default),
  }));
}

export function parseInputDrafts(inputs: InputDraft[]): { ok: true; value: InputDefinition[] } | { ok: false; message: string } {
  const parsed: InputDefinition[] = [];
  for (const input of inputs) {
    let defaultValue: unknown = undefined;
    const trimmedDefault = input.defaultValue.trim();
    if (trimmedDefault.length > 0) {
      try {
        defaultValue = JSON.parse(trimmedDefault) as unknown;
      } catch {
        return { ok: false, message: `Input "${input.name || "(unnamed)"}" default must be valid JSON.` };
      }
    }

    parsed.push({
      name: input.name,
      type: input.type,
      required: input.required,
      ...(input.description.trim().length > 0 ? { description: input.description.trim() } : {}),
      ...(trimmedDefault.length > 0 ? { default: defaultValue } : {}),
    });
  }

  return { ok: true, value: parsed };
}

export function parseEvaluationDraft(
  draft: Pick<RootDraft, "evaluationEnabled" | "reviewerRolesJson" | "criteriaJson" | "qualityGatesJson">,
):
  | {
      ok: true;
      value: Prompt["spec"]["evaluation"] | undefined;
    }
  | { ok: false; message: string } {
  if (!draft.evaluationEnabled) {
    return {
      ok: true,
      value: undefined,
    };
  }

  let reviewerRoles: unknown;
  let criteria: unknown;
  let qualityGates: unknown;

  try {
    reviewerRoles = JSON.parse(draft.reviewerRolesJson);
  } catch {
    return { ok: false, message: "Reviewer roles must be valid JSON." };
  }

  try {
    criteria = JSON.parse(draft.criteriaJson);
  } catch {
    return { ok: false, message: "Rubric criteria must be valid JSON." };
  }

  try {
    qualityGates = JSON.parse(draft.qualityGatesJson);
  } catch {
    return { ok: false, message: "Quality gates must be valid JSON." };
  }

  if (!Array.isArray(reviewerRoles)) {
    return { ok: false, message: "Reviewer roles must be a JSON array." };
  }
  if (!Array.isArray(criteria)) {
    return { ok: false, message: "Rubric criteria must be a JSON array." };
  }
  if (!Array.isArray(qualityGates)) {
    return { ok: false, message: "Quality gates must be a JSON array." };
  }

  return {
    ok: true,
    value: {
      reviewerRoles: reviewerRoles as NonNullable<Prompt["spec"]["evaluation"]>["reviewerRoles"],
      rubric: {
        criteria: criteria as NonNullable<Prompt["spec"]["evaluation"]>["rubric"]["criteria"],
      },
      qualityGates: qualityGates as NonNullable<Prompt["spec"]["evaluation"]>["qualityGates"],
    },
  };
}

export function createRootDraft(prompt: Prompt): RootDraft {
  const evaluation = prompt.spec.evaluation;
  return {
    entityKind: "prompt",
    title: prompt.metadata.title ?? "",
    description: prompt.metadata.description ?? "",
    tags: prompt.metadata.tags.join(", "),
    artifactType: prompt.spec.artifact.type,
    buildTarget: prompt.spec.buildTargets[0]?.id ?? "",
    messages: toMessageDrafts(prompt.spec.messages),
    inputs: toInputDrafts(prompt.spec.inputs),
    evaluationEnabled: Boolean(evaluation),
    reviewerRolesJson: JSON.stringify(evaluation?.reviewerRoles ?? [], null, 2),
    criteriaJson: JSON.stringify(evaluation?.rubric.criteria ?? [], null, 2),
    qualityGatesJson: JSON.stringify(evaluation?.qualityGates ?? [], null, 2),
  };
}

export function createBlockDraft(block: PromptBlock): BlockDraft {
  return {
    entityKind: "block",
    blockId: block.id,
    blockKind: block.kind,
    title: block.title,
    description: block.description ?? "",
    messages: toMessageDrafts(block.messages),
    inputs: toInputDrafts(block.inputs),
  };
}

export function createUsePromptDraft(prompt: Prompt, index: number): UsePromptDraft {
  const dep = prompt.spec.use[index]!;
  return {
    entityKind: "use_prompt",
    prompt: dep.prompt,
    mode: dep.mode ?? "",
    version: dep.version ?? "",
  };
}

export function createDraftFromSelection(selection: EditorSelection): EditorDraft {
  if (selection.kind === "prompt") {
    return createRootDraft(selection.prompt);
  }
  if (selection.kind === "block") {
    return createBlockDraft(selection.block);
  }
  return createUsePromptDraft(selection.prompt, selection.index);
}

function buildUsePromptRef(prompt: Prompt, index: number): string {
  return `use_prompt:${prompt.metadata.id}:${index}`;
}

function resolveUsePromptSelection(prompt: Prompt, nodes: StudioFlowNode[], selectedNodeId: string): EditorSelection | null {
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  if (selectedNode?.data.kind === "use_prompt") {
    const index = Number(selectedNode.data.properties.__index ?? "-1");
    if (Number.isInteger(index) && index >= 0 && prompt.spec.use[index]) {
      return {
        kind: "use_prompt",
        ref: buildUsePromptRef(prompt, index),
        prompt,
        nodeId: selectedNode.id,
        index,
      };
    }
  }

  const index = prompt.spec.use.findIndex((dep) => `use_prompt:${dep.prompt}` === selectedNodeId);
  if (index >= 0) {
    return {
      kind: "use_prompt",
      ref: buildUsePromptRef(prompt, index),
      prompt,
      nodeId: selectedNodeId,
      index,
    };
  }

  return null;
}

export function resolveEditorSelection(input: {
  canonicalPrompt: Prompt | null;
  nodes: StudioFlowNode[];
  selectedNodeId: string | null;
  focusedBlockId: string | null;
  contextualOnly?: boolean;
}): EditorSelection | null {
  const { canonicalPrompt, nodes, selectedNodeId, focusedBlockId, contextualOnly = false } = input;
  if (!canonicalPrompt) return null;
  if (contextualOnly && !selectedNodeId && !focusedBlockId) return null;

  const promptNodeId = `prompt:${canonicalPrompt.metadata.id}`;
  if (selectedNodeId === promptNodeId) {
    return {
      kind: "prompt",
      ref: promptNodeId,
      promptNodeId,
      prompt: canonicalPrompt,
    };
  }

  if (selectedNodeId?.startsWith("block:")) {
    const blockId = selectedNodeId.replace("block:", "");
    const block = findPromptBlockById(canonicalPrompt.spec.blocks, blockId);
    if (block) {
      return {
        kind: "block",
        ref: `block:${block.id}`,
        promptNodeId,
        prompt: canonicalPrompt,
        block,
      };
    }
  }

  if (selectedNodeId?.startsWith("use_prompt:")) {
    const usePromptSelection = resolveUsePromptSelection(canonicalPrompt, nodes, selectedNodeId);
    if (usePromptSelection) {
      return usePromptSelection;
    }
  }

  if (focusedBlockId) {
    const block = findPromptBlockById(canonicalPrompt.spec.blocks, focusedBlockId);
    if (block) {
      return {
        kind: "block",
        ref: `block:${block.id}`,
        promptNodeId,
        prompt: canonicalPrompt,
        block,
      };
    }
  }

  return {
    kind: "prompt",
    ref: promptNodeId,
    promptNodeId,
    prompt: canonicalPrompt,
  };
}

export function createEditorDraftSession(selection: EditorSelection): EditorDraftSession {
  const draft = createDraftFromSelection(selection);
  const canonicalHash = JSON.stringify(draft);
  return {
    ref: selection.ref,
    entityKind: draft.entityKind,
    draft,
    dirty: false,
    validationError: null,
    lastSyncedCanonicalHash: canonicalHash,
  };
}

export function getDraftHash(draft: EditorDraft): string {
  return JSON.stringify(draft);
}

export function resolveSelectionByRef(prompt: Prompt, nodes: StudioFlowNode[], ref: string): EditorSelection | null {
  if (ref === `prompt:${prompt.metadata.id}`) {
    return resolveEditorSelection({
      canonicalPrompt: prompt,
      nodes,
      selectedNodeId: ref,
      focusedBlockId: null,
    });
  }
  if (ref.startsWith("block:")) {
    return resolveEditorSelection({
      canonicalPrompt: prompt,
      nodes,
      selectedNodeId: ref,
      focusedBlockId: null,
    });
  }
  if (ref.startsWith(`use_prompt:${prompt.metadata.id}:`)) {
    const index = Number(ref.split(":").at(-1) ?? "-1");
    if (Number.isInteger(index) && index >= 0 && prompt.spec.use[index]) {
      return {
        kind: "use_prompt",
        ref,
        prompt,
        nodeId: `use_prompt:${prompt.spec.use[index]!.prompt}`,
        index,
      };
    }
  }
  return null;
}
