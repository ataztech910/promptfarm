import { PromptSchema, type Prompt, type PromptBlock } from "@promptfarm/core";
import { getPromptBlockPath } from "../model/promptTree";

export type ScopedPromptResult =
  | {
      ok: true;
      prompt: Prompt;
      blockId: string;
      blockPath: string[];
    }
  | {
      ok: false;
      message: string;
    };

function cloneBlock(block: PromptBlock): PromptBlock {
  return JSON.parse(JSON.stringify(block)) as PromptBlock;
}

function cloneScopedBlockPath(path: PromptBlock[], depth = 0): PromptBlock[] {
  const current = path[depth];
  if (!current) {
    return [];
  }

  const next = cloneBlock(current);
  if (depth < path.length - 1) {
    next.children = cloneScopedBlockPath(path, depth + 1);
  }
  return [next];
}

function collectSubtreeContribution(block: PromptBlock): {
  inputs: PromptBlock["inputs"];
  messages: PromptBlock["messages"];
} {
  const inputs = block.inputs.map((input) => ({ ...input }));
  const messages = block.messages.map((message) => ({ ...message }));

  for (const child of block.children) {
    const childContribution = collectSubtreeContribution(child);
    inputs.push(...childContribution.inputs);
    messages.push(...childContribution.messages);
  }

  return { inputs, messages };
}

export function createScopedPromptFromBlock(rootPrompt: Prompt, blockId: string): ScopedPromptResult {
  const path = getPromptBlockPath(rootPrompt.spec.blocks, blockId);
  if (path.length === 0) {
    return {
      ok: false,
      message: `Prompt block ${blockId} was not found.`,
    };
  }

  const selected = path[path.length - 1]!;
  const subtreeContribution = collectSubtreeContribution(selected);
  const scopedPrompt = PromptSchema.parse({
    apiVersion: rootPrompt.apiVersion,
    kind: rootPrompt.kind,
    metadata: {
      ...rootPrompt.metadata,
      id: `${rootPrompt.metadata.id}_${selected.id}`,
      title: `${rootPrompt.metadata.title ?? rootPrompt.metadata.id} / ${path.map((block) => block.title).join(" / ")}`,
      description: selected.description ?? rootPrompt.metadata.description,
    },
    spec: {
      artifact: rootPrompt.spec.artifact,
      // Block scope is bottom-up: selected node plus its visible descendants only.
      inputs: subtreeContribution.inputs,
      messages: subtreeContribution.messages,
      use: [],
      evaluation: rootPrompt.spec.evaluation,
      buildTargets: [],
      blocks: cloneScopedBlockPath(path),
    },
  });

  return {
    ok: true,
    prompt: scopedPrompt,
    blockId,
    blockPath: path.map((block) => block.title),
  };
}
