import type { InputDefinition, Prompt, PromptBlock } from "@promptfarm/core";
import { createStarterPrompt } from "../editor/goldenPath";
import { findPromptBlockById } from "./promptTree";

export type SkillModulePromotionResult = {
  modulePrompt: Prompt;
  updatedPrompt: Prompt;
  referenceBlockId: string;
  extractedInputNames: string[];
};

export type SkillModuleReuseResult = {
  updatedPrompt: Prompt;
  referenceBlockId: string;
  reusedInputNames: string[];
};

export type SkillModuleReference = {
  promptId: string;
  inputNames: string[];
};

const SKILL_MODULE_REFERENCE_PREFIX = "[Skill Module Reference:";

function clonePrompt<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createModuleReferenceMessage(moduleTitle: string, modulePromptId: string): string {
  return `Use reusable skill module "${moduleTitle}" from dependency "${modulePromptId}" for this subtree. Keep this block as a reference anchor inside the parent skill tree.`;
}

function createModuleReferenceDescription(modulePromptId: string): string {
  return `${SKILL_MODULE_REFERENCE_PREFIX} ${modulePromptId}] Reusable skill module reference.`;
}

function listVariableNames(template: string | undefined): string[] {
  if (!template) {
    return [];
  }
  const matches = template.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g);
  return [...matches].map((match) => match[1] ?? "").filter((name) => name.length > 0);
}

function collectBlockSubtree(block: PromptBlock): PromptBlock[] {
  return [block, ...block.children.flatMap((child) => collectBlockSubtree(child))];
}

function extractModuleInputs(prompt: Prompt, block: PromptBlock): InputDefinition[] {
  const subtree = collectBlockSubtree(block);
  const referencedNames = new Set<string>();

  for (const message of prompt.spec.messages) {
    listVariableNames(message.content).forEach((name) => referencedNames.add(name));
  }

  for (const entry of subtree) {
    listVariableNames(entry.title).forEach((name) => referencedNames.add(name));
    listVariableNames(entry.description).forEach((name) => referencedNames.add(name));
    entry.messages.forEach((message) => {
      listVariableNames(message.content).forEach((name) => referencedNames.add(name));
    });
  }

  const extracted = new Map<string, InputDefinition>();

  for (const input of prompt.spec.inputs) {
    if (referencedNames.has(input.name)) {
      extracted.set(input.name, clonePrompt(input));
    }
  }

  for (const entry of subtree) {
    for (const input of entry.inputs) {
      extracted.set(input.name, clonePrompt(input));
    }
  }

  return [...extracted.values()];
}

function clearBlockInputs(block: PromptBlock): void {
  block.inputs = [];
  block.children.forEach((child) => clearBlockInputs(child));
}

export function readSkillModuleReference(block: PromptBlock): SkillModuleReference | null {
  const description = block.description?.trim() ?? "";
  const match = description.match(/^\[Skill Module Reference:\s*([a-zA-Z0-9_:-]+)\]/);
  if (!match?.[1]) {
    return null;
  }

  return {
    promptId: match[1],
    inputNames: block.inputs.map((input) => input.name),
  };
}

export function promotePromptBlockToSkillModule(input: {
  prompt: Prompt;
  blockId: string;
  moduleTitle?: string;
}): SkillModulePromotionResult {
  const sourceBlock = findPromptBlockById(input.prompt.spec.blocks, input.blockId);
  if (!sourceBlock) {
    throw new Error(`Prompt block ${input.blockId} was not found.`);
  }

  const moduleTitle = input.moduleTitle?.trim() || `${sourceBlock.title} Skill Module`;
  const modulePrompt = createStarterPrompt(input.prompt.spec.artifact.type);
  const promotedSubtree = clonePrompt(sourceBlock);
  const extractedInputs = extractModuleInputs(input.prompt, sourceBlock);

  modulePrompt.metadata.title = moduleTitle;
  modulePrompt.metadata.description = `Reusable skill module promoted from "${sourceBlock.title}" in ${input.prompt.metadata.title ?? input.prompt.metadata.id}.`;
  modulePrompt.metadata.tags = [...new Set([...(input.prompt.metadata.tags ?? []), "skill_module", "promoted_subtree"])];
  modulePrompt.spec.messages = clonePrompt(input.prompt.spec.messages);
  modulePrompt.spec.inputs = extractedInputs;
  modulePrompt.spec.use = clonePrompt(input.prompt.spec.use);
  modulePrompt.spec.buildTargets = clonePrompt(input.prompt.spec.buildTargets);
  if (input.prompt.spec.evaluation) {
    modulePrompt.spec.evaluation = clonePrompt(input.prompt.spec.evaluation);
  } else {
    delete modulePrompt.spec.evaluation;
  }
  clearBlockInputs(promotedSubtree);
  modulePrompt.spec.blocks = [promotedSubtree];

  const updatedPrompt = clonePrompt(input.prompt);
  if (!updatedPrompt.spec.use.some((dependency) => dependency.prompt === modulePrompt.metadata.id)) {
    updatedPrompt.spec.use.push({
      prompt: modulePrompt.metadata.id,
      mode: "inline",
    });
  }

  const referenceBlock = findPromptBlockById(updatedPrompt.spec.blocks, input.blockId);
  if (!referenceBlock) {
    throw new Error(`Prompt block ${input.blockId} was not found in updated prompt.`);
  }

  referenceBlock.title = moduleTitle;
  referenceBlock.description = createModuleReferenceDescription(modulePrompt.metadata.id);
  referenceBlock.messages = [
    {
      role: "user",
      content: createModuleReferenceMessage(moduleTitle, modulePrompt.metadata.id),
    },
  ];
  referenceBlock.inputs = clonePrompt(extractedInputs);
  referenceBlock.children = [];

  return {
    modulePrompt,
    updatedPrompt,
    referenceBlockId: referenceBlock.id,
    extractedInputNames: extractedInputs.map((item) => item.name),
  };
}

export function replacePromptBlockWithSkillModuleReference(input: {
  prompt: Prompt;
  blockId: string;
  modulePrompt: Prompt;
}): SkillModuleReuseResult {
  const sourceBlock = findPromptBlockById(input.prompt.spec.blocks, input.blockId);
  if (!sourceBlock) {
    throw new Error(`Prompt block ${input.blockId} was not found.`);
  }

  if (input.modulePrompt.metadata.id === input.prompt.metadata.id) {
    throw new Error("A prompt cannot reuse itself as a skill module.");
  }

  if (input.modulePrompt.spec.artifact.type !== input.prompt.spec.artifact.type) {
    throw new Error(
      `Skill module artifact type ${input.modulePrompt.spec.artifact.type} does not match ${input.prompt.spec.artifact.type}.`,
    );
  }

  const updatedPrompt = clonePrompt(input.prompt);
  if (!updatedPrompt.spec.use.some((dependency) => dependency.prompt === input.modulePrompt.metadata.id)) {
    updatedPrompt.spec.use.push({
      prompt: input.modulePrompt.metadata.id,
      mode: "inline",
    });
  }

  const referenceBlock = findPromptBlockById(updatedPrompt.spec.blocks, input.blockId);
  if (!referenceBlock) {
    throw new Error(`Prompt block ${input.blockId} was not found in updated prompt.`);
  }

  const moduleTitle = input.modulePrompt.metadata.title ?? input.modulePrompt.metadata.id;
  referenceBlock.title = moduleTitle;
  referenceBlock.description = createModuleReferenceDescription(input.modulePrompt.metadata.id);
  referenceBlock.messages = [
    {
      role: "user",
      content: createModuleReferenceMessage(moduleTitle, input.modulePrompt.metadata.id),
    },
  ];
  referenceBlock.inputs = clonePrompt(input.modulePrompt.spec.inputs);
  referenceBlock.children = [];

  return {
    updatedPrompt,
    referenceBlockId: referenceBlock.id,
    reusedInputNames: input.modulePrompt.spec.inputs.map((item) => item.name),
  };
}
