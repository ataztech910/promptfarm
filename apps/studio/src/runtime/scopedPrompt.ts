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

function cloneScopedBlockPath(path: PromptBlock[]): PromptBlock[] {
  const [current, ...rest] = path;
  if (!current) {
    return [];
  }

  const next = cloneBlock(current);
  next.children = cloneScopedBlockPath(rest);
  return [next];
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
  const ancestors = path.slice(0, -1);
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
      // Runtime composition resolves spec.inputs/spec.messages, so selected block content
      // must be hoisted into the scoped prompt while keeping the block tree for context.
      inputs: [...rootPrompt.spec.inputs, ...ancestors.flatMap((block) => block.inputs), ...selected.inputs],
      messages: [...rootPrompt.spec.messages, ...ancestors.flatMap((block) => block.messages), ...selected.messages],
      use: rootPrompt.spec.use,
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
