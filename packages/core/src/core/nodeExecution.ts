import type { Prompt as LegacyPrompt } from "../types/prompts.js";
import { renderRuntimePrompt } from "./runtimeRender.js";
import type { TemplateVars } from "./template.js";
import {
  type InputDefinition,
  type MessageTemplate,
  type Prompt,
  type PromptBlock,
  type NodeExecutionRecord,
  type NodeExecutionScope,
  type NodeExecutionResult,
  type NodeRuntimeState,
} from "../domain/index.js";

export type ScopedPrompt = {
  inputs: InputDefinition[];
  messages: MessageTemplate[];
};

export type NodeDependencyGraph = Record<string, string[]>;

export function createNodeExecutionRecord(input: {
  executionId: string;
  promptId: string;
  nodeId: string;
  scope: NodeExecutionScope;
  sourceSnapshotHash: string;
  startedAt?: Date;
  provider?: string;
  model?: string;
}): NodeExecutionRecord {
  return {
    executionId: input.executionId,
    promptId: input.promptId,
    nodeId: input.nodeId,
    scope: input.scope,
    status: "running",
    sourceSnapshotHash: input.sourceSnapshotHash,
    startedAt: input.startedAt ?? new Date(),
    ...(input.provider !== undefined ? { provider: input.provider } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
  };
}

export function requestNodeExecutionCancellation(
  record: NodeExecutionRecord,
  requestedAt: Date = new Date(),
): NodeExecutionRecord {
  if (record.status !== "running" && record.status !== "cancel_requested") {
    return record;
  }

  return {
    ...record,
    status: "cancel_requested",
    cancelRequestedAt: record.cancelRequestedAt ?? requestedAt,
  };
}

export function cancelNodeExecutionRecord(
  record: NodeExecutionRecord,
  completedAt: Date = new Date(),
): NodeExecutionRecord {
  return {
    ...record,
    status: "cancelled",
    completedAt,
    ...(record.cancelRequestedAt !== undefined ? {} : { cancelRequestedAt: completedAt }),
  };
}

export function completeNodeExecutionRecord(
  record: NodeExecutionRecord,
  result:
    | {
        status: "success";
        output: string;
      }
    | {
        status: "error";
        errorMessage: string;
        output?: string;
      },
  completedAt: Date = new Date(),
): NodeExecutionRecord {
  if (result.status === "success") {
    return {
      ...record,
      status: "success",
      output: result.output,
      completedAt,
    };
  }

  return {
    ...record,
    status: "error",
    completedAt,
    errorMessage: result.errorMessage,
    ...(result.output !== undefined ? { output: result.output } : {}),
  };
}

function findBlockById(blocks: PromptBlock[], id: string): PromptBlock | null {
  for (const block of blocks) {
    if (block.id === id) {
      return block;
    }
    const found = findBlockById(block.children, id);
    if (found) return found;
  }
  return null;
}

function buildPath(targetId: string, blocks: PromptBlock[], currentPath: PromptBlock[] = []): PromptBlock[] | null {
  for (const block of blocks) {
    const nextPath = [...currentPath, block];
    if (block.id === targetId) {
      return nextPath;
    }
    const nested = buildPath(targetId, block.children, nextPath);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function scopedInputsToLegacy(inputs: InputDefinition[]): NonNullable<LegacyPrompt["inputs"]> | undefined {
  if (inputs.length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    inputs.map((input) => [
      input.name,
      {
        type: input.type,
        required: input.required,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.default !== undefined ? { default: input.default } : {}),
      },
    ]),
  );
}

function createScopedLegacyPrompt(blockId: string, prompt: Prompt, scoped: ScopedPrompt): LegacyPrompt {
  const legacyInputs = scopedInputsToLegacy(scoped.inputs);
  return {
    id: `${prompt.metadata.id}_${blockId}`,
    title: `${prompt.metadata.title ?? prompt.metadata.id} / ${blockId}`,
    version: prompt.metadata.version,
    use: [],
    tags: prompt.metadata.tags,
    messages: scoped.messages,
    ...(legacyInputs ? { inputs: legacyInputs } : {}),
  };
}

function createScopedVars(inputs: InputDefinition[], vars: Record<string, unknown>): TemplateVars {
  const provided = Object.entries(vars).reduce<TemplateVars>((acc, [key, value]) => {
    if (value === null || value === undefined) {
      acc[key] = value;
      return acc;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      acc[key] = value;
      return acc;
    }
    acc[key] = JSON.stringify(value);
    return acc;
  }, {});

  for (const input of inputs) {
    if (provided[input.name] !== undefined) {
      continue;
    }
    if (typeof input.default === "string" || typeof input.default === "number" || typeof input.default === "boolean" || input.default === null) {
      provided[input.name] = input.default;
      continue;
    }
    if (input.default !== undefined) {
      provided[input.name] = JSON.stringify(input.default);
      continue;
    }
    provided[input.name] = `<${input.name}>`;
  }

  return provided;
}

export function createNodeDependencyGraph(prompt: Prompt): NodeDependencyGraph {
  const graph: NodeDependencyGraph = {};

  function walk(blocks: PromptBlock[]): void {
    for (const block of blocks) {
      graph[block.id] = block.children.map((child) => child.id);
      walk(block.children);
    }
  }

  walk(prompt.spec.blocks);
  return graph;
}

export function extractScopedPrompt(blockId: string, prompt: Prompt): ScopedPrompt | null {
  const block = findBlockById(prompt.spec.blocks, blockId);
  if (!block) return null;

  const path = buildPath(block.id, prompt.spec.blocks) ?? [];

  const inputs: InputDefinition[] = [];
  const messages: MessageTemplate[] = [...prompt.spec.messages];

  for (const ancestor of path) {
    inputs.push(...ancestor.inputs);
    messages.push(...ancestor.messages);
  }

  return { inputs, messages };
}

export function runNode(
  blockId: string,
  prompt: Prompt,
  vars: Record<string, unknown> = {},
): NodeExecutionResult {
  const scoped = extractScopedPrompt(blockId, prompt);
  if (!scoped) {
    return {
      nodeId: blockId,
      output: `Prompt block ${blockId} was not found.`,
      status: "error",
      executedAt: new Date(),
    };
  }

  const rendered = renderRuntimePrompt({
    prompt: createScopedLegacyPrompt(blockId, prompt, scoped),
    vars: createScopedVars(scoped.inputs, vars),
    target: "generic",
  });

  if (rendered.issues.length > 0 || rendered.output === null) {
    return {
      nodeId: blockId,
      output: rendered.issues.join("\n"),
      status: "error",
      executedAt: new Date(),
    };
  }

  return {
    nodeId: blockId,
    output: rendered.output,
    status: "success",
    executedAt: new Date(),
    executionTimeMs: 0,
  };
}

export function updateNodeRuntimeState(
  states: NodeRuntimeState[],
  result: NodeExecutionResult,
): NodeRuntimeState[] {
  return states.map((state) =>
    state.nodeId === result.nodeId
      ? {
          ...state,
          status: result.status === "success" ? "success" : "error",
          output: result.output,
          lastRunAt: result.executedAt,
        }
      : state,
  );
}

export function markStaleIfUpstreamChanged(
  states: NodeRuntimeState[],
  changedNodeIds: string[],
  dependencyGraph: NodeDependencyGraph = {},
): NodeRuntimeState[] {
  const staleNodeIds = new Set<string>();
  const queue = [...changedNodeIds];

  while (queue.length > 0) {
    const currentNodeId = queue.shift();
    if (!currentNodeId) {
      continue;
    }
    const downstreamNodeIds = dependencyGraph[currentNodeId] ?? [];
    for (const downstreamNodeId of downstreamNodeIds) {
      if (staleNodeIds.has(downstreamNodeId)) {
        continue;
      }
      staleNodeIds.add(downstreamNodeId);
      queue.push(downstreamNodeId);
    }
  }

  return states.map((state) =>
    staleNodeIds.has(state.nodeId) && state.status !== "idle"
      ? {
          ...state,
          status: "stale",
        }
      : state,
  );
}

export function assembleFinalOutput(states: NodeRuntimeState[]): string {
  return states
    .flatMap((state) => (state.enabled && state.output ? [state.output] : []))
    .join("\n\n");
}
