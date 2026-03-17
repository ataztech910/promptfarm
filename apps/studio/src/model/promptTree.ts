import type { Prompt, PromptBlock, PromptBlockKind } from "@promptfarm/core";
import { ArtifactType, getAllowedPromptBlockKinds, isAllowedPromptBlockKind } from "@promptfarm/core";

export type PromptBlockReference = {
  block: PromptBlock;
  parentId: string | null;
  depth: number;
  index: number;
};

const DEFAULT_BLOCK_TITLE: Record<PromptBlockKind, string> = {
  chapter: "New Chapter",
  section: "New Section",
  module: "New Module",
  lesson: "New Lesson",
  phase: "New Phase",
  step_group: "New Step Group",
  generic_block: "New Block",
};

const DEFAULT_BLOCK_CONTENT: Record<PromptBlockKind, string> = {
  chapter: "Draft the chapter structure, arc, and key subsections.",
  section: "Draft this section with focused detail and continuity.",
  module: "Draft the module goals, scope, and lessons.",
  lesson: "Draft the lesson objective, teaching flow, and examples.",
  phase: "Draft the phase objective, sequence, and constraints.",
  step_group: "Draft the grouped procedural steps for this phase.",
  generic_block: "Describe the content for this block.",
};

function cloneBlocks(blocks: PromptBlock[]): PromptBlock[] {
  return JSON.parse(JSON.stringify(blocks)) as PromptBlock[];
}

export function listPromptBlocks(blocks: PromptBlock[], depth = 0, parentId: string | null = null): PromptBlockReference[] {
  return blocks.flatMap((block, index) => [
    { block, parentId, depth, index },
    ...listPromptBlocks(block.children, depth + 1, block.id),
  ]);
}

export function findPromptBlockById(blocks: PromptBlock[], blockId: string): PromptBlock | undefined {
  for (const block of blocks) {
    if (block.id === blockId) return block;
    const child = findPromptBlockById(block.children, blockId);
    if (child) return child;
  }
  return undefined;
}

export function findPromptBlockReference(blocks: PromptBlock[], blockId: string): PromptBlockReference | undefined {
  return listPromptBlocks(blocks).find((entry) => entry.block.id === blockId);
}

export function getPromptBlockPath(blocks: PromptBlock[], blockId: string): PromptBlock[] {
  function walk(items: PromptBlock[], acc: PromptBlock[]): PromptBlock[] | null {
    for (const block of items) {
      const nextAcc = [...acc, block];
      if (block.id === blockId) return nextAcc;
      const nested = walk(block.children, nextAcc);
      if (nested) return nested;
    }
    return null;
  }

  return walk(blocks, []) ?? [];
}

export function filterPromptByHiddenBlocks(
  prompt: Prompt,
  hiddenBlockIds: string[],
  hiddenDependencyPromptIds: string[] = [],
  preserveBlockId?: string | null,
): Prompt {
  if (hiddenBlockIds.length === 0 && hiddenDependencyPromptIds.length === 0) {
    return prompt;
  }

  const hiddenIds = new Set(hiddenBlockIds);
  const hiddenDependencyIds = new Set(hiddenDependencyPromptIds);
  const preservedPathIds = new Set(
    preserveBlockId ? getPromptBlockPath(prompt.spec.blocks, preserveBlockId).map((block) => block.id) : [],
  );

  function filterBlocks(blocks: PromptBlock[]): PromptBlock[] {
    return blocks.flatMap((block) => {
      if (hiddenIds.has(block.id) && !preservedPathIds.has(block.id)) {
        return [];
      }

      return [
        {
          ...block,
          children: filterBlocks(block.children),
        },
      ];
    });
  }

  return {
    ...prompt,
    spec: {
      ...prompt.spec,
      use: prompt.spec.use.filter((dep) => !hiddenDependencyIds.has(dep.prompt)),
      blocks: filterBlocks(prompt.spec.blocks),
    },
  };
}

export function withMutableBlock(
  prompt: Prompt,
  blockId: string,
  mutate: (block: PromptBlock) => void,
): boolean {
  const block = findPromptBlockById(prompt.spec.blocks, blockId);
  if (!block) return false;
  mutate(block);
  return true;
}

function createUniqueBlockId(prompt: Prompt, base: PromptBlockKind): string {
  const existing = new Set(listPromptBlocks(prompt.spec.blocks).map((entry) => entry.block.id));
  let index = 1;
  let candidate = `${base}_${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `${base}_${index}`;
  }
  return candidate;
}

export function createPromptBlock(prompt: Prompt, kind: PromptBlockKind): PromptBlock {
  return {
    id: createUniqueBlockId(prompt, kind),
    kind,
    title: DEFAULT_BLOCK_TITLE[kind],
    inputs: [],
    messages: [
      {
        role: "user",
        content: DEFAULT_BLOCK_CONTENT[kind],
      },
    ],
    children: [],
  };
}

export function addPromptBlock(prompt: Prompt, kind: PromptBlockKind, parentBlockId?: string | null): PromptBlock {
  const parent = parentBlockId ? findPromptBlockById(prompt.spec.blocks, parentBlockId) : undefined;
  const parentKind = parent?.kind ?? null;
  if (!isAllowedPromptBlockKind(prompt.spec.artifact.type, kind, parentKind)) {
    const allowedKinds = getAllowedPromptBlockKinds(prompt.spec.artifact.type, parentKind);
    throw new Error(
      `Block kind "${kind}" is not allowed under ${parentKind ?? "root"} for artifact type "${prompt.spec.artifact.type}". Allowed children: ${allowedKinds.join(", ") || "(none)"}.`,
    );
  }

  const block = createPromptBlock(prompt, kind);
  if (!parentBlockId) {
    prompt.spec.blocks.push(block);
    return block;
  }

  if (!parent) {
    throw new Error(`Parent block ${parentBlockId} was not found.`);
  }
  parent.children.push(block);
  return block;
}

export function removePromptBlock(prompt: Prompt, blockId: string): boolean {
  function removeFrom(blocks: PromptBlock[]): boolean {
    const index = blocks.findIndex((block) => block.id === blockId);
    if (index >= 0) {
      blocks.splice(index, 1);
      return true;
    }
    return blocks.some((block) => removeFrom(block.children));
  }

  return removeFrom(prompt.spec.blocks);
}

export function movePromptBlock(prompt: Prompt, blockId: string, direction: "up" | "down"): boolean {
  function moveIn(blocks: PromptBlock[]): boolean {
    const index = blocks.findIndex((block) => block.id === blockId);
    if (index >= 0) {
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= blocks.length) {
        return false;
      }
      const [block] = blocks.splice(index, 1);
      blocks.splice(nextIndex, 0, block!);
      return true;
    }
    return blocks.some((block) => moveIn(block.children));
  }

  return moveIn(prompt.spec.blocks);
}

function getPromptBlockList(prompt: Prompt, parentId: string | null): PromptBlock[] | null {
  if (parentId === null) {
    return prompt.spec.blocks;
  }

  const parent = findPromptBlockById(prompt.spec.blocks, parentId);
  return parent ? parent.children : null;
}

function detachPromptBlock(blocks: PromptBlock[], blockId: string): PromptBlock | null {
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index >= 0) {
    const [block] = blocks.splice(index, 1);
    return block ?? null;
  }

  for (const block of blocks) {
    const detached = detachPromptBlock(block.children, blockId);
    if (detached) {
      return detached;
    }
  }

  return null;
}

export function reparentPromptBlock(prompt: Prompt, blockId: string, targetBlockId: string | null): boolean {
  if (blockId === targetBlockId) {
    return false;
  }

  const block = findPromptBlockById(prompt.spec.blocks, blockId);
  if (!block) {
    return false;
  }

  const target = targetBlockId ? findPromptBlockById(prompt.spec.blocks, targetBlockId) : null;

  if (targetBlockId) {
    if (!target) {
      return false;
    }

    if (getPromptBlockPath(prompt.spec.blocks, targetBlockId).some((entry) => entry.id === blockId)) {
      return false;
    }

    if (!isAllowedPromptBlockKind(prompt.spec.artifact.type, block.kind, target.kind)) {
      return false;
    }
  } else if (!isAllowedPromptBlockKind(prompt.spec.artifact.type, block.kind, null)) {
    return false;
  }

  const detached = detachPromptBlock(prompt.spec.blocks, blockId);
  if (!detached) {
    return false;
  }

  if (!targetBlockId) {
    prompt.spec.blocks.push(detached);
    return true;
  }

  if (!target) {
    return false;
  }

  target.children.push(detached);
  return true;
}

export function relocatePromptBlock(prompt: Prompt, blockId: string, targetParentId: string | null, targetIndex: number): boolean {
  const block = findPromptBlockById(prompt.spec.blocks, blockId);
  if (!block) {
    return false;
  }

  if (targetParentId === blockId) {
    return false;
  }

  const currentRef = findPromptBlockReference(prompt.spec.blocks, blockId);
  if (!currentRef) {
    return false;
  }

  const targetParent = targetParentId ? findPromptBlockById(prompt.spec.blocks, targetParentId) : null;
  if (targetParentId && !targetParent) {
    return false;
  }

  if (targetParentId && getPromptBlockPath(prompt.spec.blocks, targetParentId).some((entry) => entry.id === blockId)) {
    return false;
  }

  if (!isAllowedPromptBlockKind(prompt.spec.artifact.type, block.kind, targetParent?.kind ?? null)) {
    return false;
  }

  const currentList = getPromptBlockList(prompt, currentRef.parentId);
  if (!currentList) {
    return false;
  }

  const currentIndex = currentList.findIndex((entry) => entry.id === blockId);
  if (currentIndex < 0) {
    return false;
  }

  const [detached] = currentList.splice(currentIndex, 1);
  if (!detached) {
    return false;
  }

  const targetList = getPromptBlockList(prompt, targetParentId);
  if (!targetList) {
    currentList.splice(currentIndex, 0, detached);
    return false;
  }

  const nextIndex = Math.max(0, Math.min(targetIndex, targetList.length));

  targetList.splice(nextIndex, 0, detached);
  return true;
}

export function clonePromptWithBlocks(prompt: Prompt): Prompt {
  return {
    ...prompt,
    spec: {
      ...prompt.spec,
      blocks: cloneBlocks(prompt.spec.blocks),
    },
  };
}

export function getSuggestedBlockKinds(prompt: Prompt, parentBlockId?: string | null): PromptBlockKind[] {
  if (parentBlockId) {
    const parent = findPromptBlockById(prompt.spec.blocks, parentBlockId);
    if (!parent) return [];
    return getAllowedPromptBlockKinds(prompt.spec.artifact.type, parent.kind);
  }
  return getAllowedPromptBlockKinds(prompt.spec.artifact.type, null);
}

export function getSiblingBlockKinds(prompt: Prompt, blockId: string): PromptBlockKind[] {
  const ref = findPromptBlockReference(prompt.spec.blocks, blockId);
  if (!ref) return [];
  return getSuggestedBlockKinds(prompt, ref.parentId);
}

export function describeTreeEmptyState(prompt: Prompt): string {
  if (prompt.spec.artifact.type === ArtifactType.BookText) {
    return "Start the book with a chapter, then add sections inside each chapter.";
  }
  if (prompt.spec.artifact.type === ArtifactType.Course) {
    return "Start the course with a module, then add lessons inside each module.";
  }
  if (prompt.spec.artifact.type === ArtifactType.Instruction) {
    return "Start the instruction with a phase, then add step groups inside each phase.";
  }
  return "Add a block to start structuring this artifact.";
}
