import { PromptSchema, type InputDefinition, type MessageTemplate, type Prompt, type PromptBlock } from "@promptfarm/core";
import type { StudioRuntimeExecutionScope } from "./createRuntimePreview";
import { createScopedPromptFromBlock } from "./scopedPrompt";

type PromptTreeContribution = {
  inputs: InputDefinition[];
  messages: MessageTemplate[];
};

function clonePrompt(prompt: Prompt): Prompt {
  return JSON.parse(JSON.stringify(prompt)) as Prompt;
}

function collectBlockContribution(blocks: PromptBlock[]): PromptTreeContribution {
  const inputs: InputDefinition[] = [];
  const messages: MessageTemplate[] = [];

  const visit = (block: PromptBlock): void => {
    inputs.push(...block.inputs.map((input) => ({ ...input })));
    messages.push(...block.messages.map((message) => ({ ...message })));
    block.children.forEach(visit);
  };

  blocks.forEach(visit);

  return {
    inputs,
    messages,
  };
}

export function createAssembledRootPrompt(rootPrompt: Prompt): Prompt {
  const nextPrompt = clonePrompt(rootPrompt);
  const contribution = collectBlockContribution(rootPrompt.spec.blocks);
  nextPrompt.spec.inputs = [...nextPrompt.spec.inputs, ...contribution.inputs];
  nextPrompt.spec.messages = [...nextPrompt.spec.messages, ...contribution.messages];
  return PromptSchema.parse(nextPrompt);
}

export function resolveEffectivePromptForStudioScope(
  rootPrompt: Prompt,
  scope: StudioRuntimeExecutionScope,
):
  | {
      ok: true;
      prompt: Prompt;
      blockPath: string[];
    }
  | {
      ok: false;
      message: string;
    } {
  if (scope.mode === "root") {
    return {
      ok: true,
      prompt: createAssembledRootPrompt(rootPrompt),
      blockPath: [],
    };
  }

  const scoped = createScopedPromptFromBlock(rootPrompt, scope.blockId);
  if (!scoped.ok) {
    return scoped;
  }

  return {
    ok: true,
    prompt: scoped.prompt,
    blockPath: scoped.blockPath,
  };
}
